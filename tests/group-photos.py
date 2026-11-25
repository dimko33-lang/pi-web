"""Turn-scoped group photos: synthetic Telegram + SQLite and real Pi HTTP bodies. No cloud or account."""
import asyncio
import base64
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import AsyncMock, patch
import zlib

spec=importlib.util.spec_from_file_location('memory_fixture',Path(__file__).with_name('participant-memory.py'))
fx=importlib.util.module_from_spec(spec);spec.loader.exec_module(fx)
import motion_frames
from group_photos import complete_turn, photo_key, MAX_SOURCE, UNAVAILABLE
from turn_wait import PiReply

ROOM,OTHER,A,B,ME=fx.ROOM,fx.OTHER,fx.A,fx.B,fx.ME
PROFILE=dict(personOn=False,groupOn=False,backgroundOn=True,personLimit=4,memoryLimit=4,backgroundLimit=50,
             memory=True,memoryResetAt=0,memoryEpoch='initial',toolsOn=False,textOutput=True,voiceOutput=False,
             model='fixture/test',thinking='off',basePrompt='Synthetic test.',replyMode='all')


def png(rgb):
    def chunk(name,data):return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',3,3,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes(rgb)*3)*3))+chunk(b'IEND',b'')


class PhotoClient(fx.Client):
    def __init__(self):super().__init__();self.downloads=[];self.on_download=None
    def photo(self,peer,mid,who,rgb,caption=''):
        m=self.post(peer,mid,who,caption);m.bytes=png(rgb);m.document=N(id=1000+mid)
        m.file=N(size=len(m.bytes),mime_type='image/png',name='still.png');m.download_media=lambda **kw:self.download_media(m,**kw);return m
    async def download_media(self,m,*,file):
        self.downloads.append((m.chat_id,m.id));file.write(m.bytes)
        if self.on_download:self.on_download()


def image_urls(request):
    return [p['image_url']['url'] for m in request['messages'] if isinstance(m['content'],list) for p in m['content'] if p.get('type')=='image_url']


def selector(prompt,mid):
    ticket=re.search(r'\[OPEN_GROUP_PHOTO ([0-9a-f]{24}) ID\]',prompt)
    return f'[OPEN_GROUP_PHOTO {ticket[1]} {mid}]' if ticket else 'No marker here.'


def decide(request):
    text=fx.user_payload(request); q=text.rsplit('[Current message from user (id ',1)[-1].split(']:\n',1)[-1].split('\n',1)[0]
    if image_urls(request):return 'VISUAL_ANSWER'
    if 'station notice' in q:return selector(text,10)
    if 'sign above' in q or 'colour of its letters' in q:return selector(text,12)
    if 'ambiguous' in q:return 'Which of the two photos?'
    return 'WEATHER_ANSWER'


async def provider_scenario(c,room,db,profile,turn,seen):
    """Also used against the reference handler. Every assertion is about a real serialized provider body."""
    wrong=c.photo(OTHER,12,A,(10,40,115));captioned=c.photo(room,10,B,(163,0,22),'Notice at the station')
    c.post(room,11,ME,'Earlier station dialogue',10);fx.pm.remember_reply(db,room,B,10,11)
    pic=c.photo(room,12,A,(0,166,22));c.post(room,13,ME,'Earlier dialogue',12);fx.pm.remember_reply(db,room,A,12,13)
    n=len(seen);await turn(20,'@nika Weather today?');assert len(seen)==n+1
    def no_pixels(req):
        body=json.dumps(req);assert not image_urls(req) and 'data:image/' not in body
        assert all(base64.b64encode(m.bytes).decode() not in body for m in (pic,wrong,captioned))
    no_pixels(seen[-1]);initial=fx.user_payload(seen[-1]);rows=json.JSONDecoder().raw_decode(initial.split(fx.pm.HEADER,1)[1])[0]['background'];assert [(r['id'],r['text']) for r in rows if r.get('photo')]==[(10,'Notice at the station'),(12,'')] and not c.downloads
    for mid,question in [(22,'What is written on the sign above?'),(26,'And the colour of its letters?')]:
        before=len(seen);await turn(mid,'@nika '+question);assert len(seen)==before+2
        plan,visual=seen[-2:];no_pixels(plan);assert image_urls(visual)==['data:image/png;base64,'+base64.b64encode(pic.bytes).decode()]
        token=re.search(r'OPEN_GROUP_PHOTO ([0-9a-f]{24}) ID',fx.user_payload(plan))[1]
        assert token not in json.dumps(visual) and 'photo from message 12' in fx.user_payload(visual)
        downloads=list(c.downloads);assert downloads==[(room,12)]*(1 if mid==22 else 2)
        await turn(mid+2,'@nika Weather tomorrow?');assert len(seen)==before+3
        no_pixels(seen[-1]);body=json.dumps(seen[-1]);assert token not in body and 'VISUAL_ANSWER' in body and 'nikita-turn-photo-' not in body and c.downloads==downloads
    before=len(seen);await turn(30,'@nika ambiguous photo?');no_pixels(seen[-1]);assert len(seen)==before+1 and len(c.downloads)==2
    profile.update(backgroundOn=False,memory=False);before=len(seen);await turn(32,'@nika Weather after reset?');assert len(seen)==before+1 and 'OPEN_GROUP_PHOTO' not in fx.user_payload(seen[-1]);no_pixels(seen[-1])
    # With Tools on, the same negotiation must still use only the chosen Person or Group source.
    profile.update(memory=True,toolsOn=True,personOn=True,personLimit=50)
    for mid,question,source,name in [(34,'sign above?',pic,'person'),(36,'station notice?',captioned,'group')]:
        if mid==36: profile.update(personOn=False,groupOn=True)
        before=len(seen);await turn(mid,'@nika '+question);assert len(seen)==before+2
        plan,visual=seen[-2:];no_pixels(plan);rows=json.JSONDecoder().raw_decode(fx.user_payload(plan).split(fx.pm.HEADER,1)[1])[0]
        assert {name}==set(rows) and [r['id'] for r in rows[name] if r.get('photo')]==[source.id]
        assert image_urls(visual)==['data:image/png;base64,'+base64.b64encode(source.bytes).decode()]
    profile['memoryResetAt']=37000;before=len(seen);await turn(38,'@nika sign above?');assert len(seen)==before+1 and 'OPEN_GROUP_PHOTO' not in fx.user_payload(seen[-1]);no_pixels(seen[-1]);assert c.downloads==[(room,12),(room,12),(room,12),(room,10)]
    assert all(peer==room for peer,*_ in c.calls)


class Photos(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        d=tempfile.TemporaryDirectory();self.addCleanup(d.cleanup);self.root=Path(d.name);self.c=PhotoClient();self.p=dict(PROFILE)
        self.state=fx.PeerState(self.root,ROOM);self.db=self.state.db;self.addCleanup(self.db.close)
    async def select(self,before=100,quote=None):
        return await fx.pm.group_inputs(self.c,self.db,ROOM,A,before,quote,self.p,lambda:self.p if self.p.get('replyMode')=='all' else None)
    async def test_eligible_rows_only(self):
        c=self.c;p=self.p
        for mid,who in [(10,A),(20,B)]:
            c.photo(ROOM,mid,who,(0,mid,50));c.post(ROOM,mid+1,ME,'Answer',mid);fx.pm.remember_reply(self.db,ROOM,who,mid,mid+1)
        c.photo(ROOM,30,B,(0,60,50));c.photo(OTHER,30,B,(0,70,50));self.assertFalse(c.downloads)
        for flags,ids in [((1,0,0),{10}),((0,1,0),{20}),((0,0,1),{10,20,30}),((1,1,1),{10,20,30}),((0,0,0),set())]:
            p.update(zip(('personOn','groupOn','backgroundOn'),map(bool,flags)));c.calls=[];text,photos=await self.select()
            self.assertEqual(set(photos.keys) if photos else set(),ids);self.assertEqual(text.count('"photo":true'),len(ids));self.assertFalse(c.downloads)
            if not ids:self.assertFalse(c.calls)
        p.update(backgroundOn=True,backgroundLimit=1);self.assertIsNone((await self.select(quote=30))[1]);p['memoryResetAt']=30001;self.assertIsNone((await self.select())[1]);p['memoryResetAt']=0
        p.update(backgroundOn=False,personOn=True,personLimit=1);self.assertIsNone((await self.select())[1])  # Only the answer fits.
        p.update(personLimit=2);c.rows[ROOM,11].reply_to_msg_id=77;self.assertIsNone((await self.select())[1])
        p.update(personOn=False,backgroundOn=True,backgroundLimit=40)
        with patch.object(fx.pm,'TOTAL_BYTES',68):self.assertIsNone((await self.select())[1])
    async def test_revalidate_and_fail_closed(self):
        c=self.c;p=self.p
        for fault in ('changed','wrong_peer','deleted','protected','revoked','reset','window_off','lost_pair','during_download','pair_during_download','bad_bytes'):
            with self.subTest(fault=fault):
                p.update(PROFILE,personOn=True,backgroundOn=False);m=c.photo(ROOM,40,A,(1,2,3));c.post(ROOM,41,ME,'Reply',40);fx.pm.remember_reply(self.db,ROOM,A,40,41)
                _,photos=await self.select();self.assertIn(40,photos.keys);c.downloads.clear();c.on_download=None
                if fault=='changed':m.document.id+=1
                if fault=='wrong_peer':m.chat_id=OTHER
                if fault=='deleted':del c.rows[ROOM,40]
                if fault=='protected':m.noforwards=True
                if fault=='revoked':p['replyMode']='off'
                if fault=='reset':p['memoryResetAt']=99000
                if fault=='window_off':p['personOn']=False
                if fault=='lost_pair':del c.rows[ROOM,41]
                if fault=='during_download':c.on_download=lambda:c.rows.pop((ROOM,40))
                if fault=='pair_during_download':c.on_download=lambda:c.rows.pop((ROOM,41))
                if fault=='bad_bytes':m.bytes=b'bad'+m.bytes[3:]
                invoke=AsyncMock(side_effect=lambda text,_:(0,PiReply(text=selector(text,40),settled=True)))
                _,r=await complete_turn(photos,'Q',invoke);self.assertEqual(r.text,UNAVAILABLE);self.assertEqual(invoke.await_count,1)
                self.assertEqual(c.downloads,[(ROOM,40)] if fault in ('during_download','pair_during_download','bad_bytes') else [])
    async def test_single_use_no_tool_replay_and_cleanup(self):
        m=self.c.photo(ROOM,33,A,(0,88,44));_,photos=await self.select();old=photos.ticket;paths=[]
        async def interrupted(text,frames):
            if not frames:return 0,PiReply(text=selector(text,33),settled=True)
            paths.extend(frames);self.assertEqual(frames[0].read_bytes(),m.bytes);raise asyncio.CancelledError
        with self.assertRaises(asyncio.CancelledError):await complete_turn(photos,'Q',interrupted)
        self.assertFalse(paths[0].parent.exists());self.c.downloads.clear()
        with self.assertRaises(ValueError):await complete_turn(photos,'Q',interrupted)
        for target,used in [(lambda t:selector(t,33),True),(lambda t:selector(t,37),False),(lambda t:'[OPEN_GROUP_PHOTO '+old+' 33]',False)]:
            _,fresh=await self.select();invoke=AsyncMock(side_effect=lambda t,_:(0,PiReply(text=target(t),settled=True,used_tools=used)))
            _,r=await complete_turn(fresh,'Q',invoke);self.assertEqual(r.text,UNAVAILABLE);self.assertEqual(invoke.await_count,1)
        self.assertFalse(self.c.downloads)
    def test_telegram_photo_and_image_document(self):
        from telethon.tl import types as T
        date=datetime.now(timezone.utc);peer=T.PeerChannel(1234)
        native=T.MessageMediaPhoto(photo=T.Photo(31,11,b'',date,[T.PhotoSize('x',30,20,640)],2))
        document=T.MessageMediaDocument(document=T.Document(32,11,b'',date,'image/png',1800,2,[T.DocumentAttributeFilename('diagram.png')]))
        for media,expected in [(native,(31,'image/jpeg',640)),(document,(32,'image/png',1800))]:
            msg=T.Message(13,peer,date=date,message='',out=False,from_id=T.PeerUser(15),media=media)
            self.assertEqual(photo_key(msg)[3:6],expected);media.spoiler=True;self.assertIsNone(photo_key(msg))
        native.spoiler=False;native.live_photo=True;self.assertIsNone(photo_key(T.Message(14,peer,media=native)))
    @unittest.skipUnless(os.environ.get('TEST_PHOTO_DECODER'),'optional: point TEST_PHOTO_DECODER at an installed media-decoder/frames.cjs')
    async def test_large_still_becomes_bounded_jpeg(self):
        msg=self.c.photo(ROOM,33,A,(21,56,110));msg.bytes+=b'\0'*1_600_000;msg.file.size=len(msg.bytes);_,photos=await self.select();paths=[]
        async def invoke(text,images):
            if not images:return 0,PiReply(text=selector(text,33),settled=True)
            paths.extend(images);data=images[0].read_bytes();self.assertTrue(data.startswith(b'\xff\xd8\xff'));self.assertLess(len(data),50_000);return 0,PiReply(text='Verified',settled=True)
        with patch.object(motion_frames,'WORKER',Path(os.environ['TEST_PHOTO_DECODER'])):
            _,result=await complete_turn(photos,'Q',invoke);self.assertEqual(result.text,'Verified')
        self.assertFalse(paths[0].exists());self.assertEqual(self.c.downloads,[(ROOM,33)])
    async def test_unsupported_sources(self):
        c=self.c
        for n,kwargs in enumerate([dict(media=N(ttl_seconds=5)),dict(media=N(spoiler=True)),dict(media=N(webpage=True)),dict(ttl_period=42),dict(noforwards=True),dict(sticker=True),dict(gif=True),dict(file=N(size=MAX_SOURCE+1,mime_type='image/png')),dict(file=N(size=100,mime_type='video/mp4')),dict(file=N(size=100,mime_type='audio/ogg')),dict(document=None)]):
            m=c.photo(ROOM,n+1,A,(0,83,18));m.__dict__.update(kwargs);self.assertIsNone(photo_key(m))
        self.assertIsNone((await self.select())[1]);self.assertFalse(c.downloads)
    @unittest.skipUnless(os.environ.get('TEST_PI_BIN'),'set TEST_PI_BIN for Pi payload checks')
    async def test_provider_no_image_carryover(self):
        c=self.c;p=self.p
        async def send(m,answer,**kw):
            self.assertNotIn('OPEN_GROUP_PHOTO',answer);c.post(ROOM,m.id+1,ME,answer,m.id);return [m.id+1]
        g=fx.Group(c,await c.get_me(),ROOM,'lake',self.state,lambda *_:(p,'all',[]),fx.instance.answer,send)
        async def turn(mid,question):await g.handle(c.post(ROOM,mid,A,question))
        with fx.local_provider(self.root,lambda _:decide(seen[-1]),vision=True) as seen,patch.object(fx.instance,'BASE',self.root),patch.dict(os.environ,{'PI_WEB_PI_BIN':os.environ['TEST_PI_BIN']}):
            await provider_scenario(c,ROOM,self.db,p,turn,seen);self.assertEqual(len(seen),14)
        self.assertFalse(list(self.root.rglob('*.jsonl')));self.assertNotIn('base64', '\n'.join(self.db.iterdump()))


if __name__=='__main__':unittest.main()
