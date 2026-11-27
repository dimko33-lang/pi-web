"""Synthetic group + SQLite. Set TEST_PI_BIN for a real Pi turn against an isolated loopback provider."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
from loopback_provider import local_provider, user_payload
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'telegram'))
import participant_memory as pm
from group_replies import Group, PeerState
import instance

ROOM, OTHER, A, B, ME = -1001234501,-1001234502,17,18,70
DEFAULT = dict(personLimit=100,memoryLimit=0,backgroundLimit=0,memory=True,memoryResetAt=0)


class Client:
    def __init__(self):self.rows={};self.calls=[]
    def post(self,peer,mid,who,text,reply=None):
        m=N(id=mid,chat_id=peer,sender_id=who,out=who==ME,raw_text=text,message=text,reply_to_msg_id=reply,reply_to=None,
            date=datetime.fromtimestamp(mid,timezone.utc),entities=[],fwd_from=None,photo=None,document=None,rich_message=None)
        m.get_reply_message=AsyncMock(side_effect=lambda:self.rows.get((peer,reply)))
        self.rows[peer,mid]=m;return m
    async def get_me(self):return N(id=ME,username='nika')
    @asynccontextmanager
    async def action(self,*args):yield
    async def get_messages(self,peer,ids=None,from_user=None,max_id=None,limit=None,**kw):
        self.calls.append((peer,from_user,ids,limit))
        if ids is not None:
            return [self.rows.get((peer,i)) for i in ids] if isinstance(ids,list) else self.rows.get((peer,ids))
        return sorted((m for (room,i),m in self.rows.items() if room==peer and i<max_id and
                       (from_user is None or m.sender_id==(ME if from_user=='me' else from_user))),key=lambda m:-m.id)[:limit]
    def pair(self,db,peer,who,mid,topic,record=True):
        self.post(peer,mid,who,f'{topic}_QUESTION_{mid}');self.post(peer,mid+1,ME,f'{topic}_ANSWER_{mid}',mid)
        if record:pm.remember_reply(db,peer,who,mid,mid+1)


def packed(prompt):return json.loads(prompt.split('\n',1)[1]) if prompt else {}


async def exercise_switches(client,peer,start,profile,turn,seen):
    """Run all eight masks with nonzero saved counts, then resume Person without editing its 100."""
    profile.update(personLimit=100,memoryLimit=2,backgroundLimit=1)
    for i,mask in enumerate([*range(8),0,1]):
        mid=start+i*4;client.post(peer,mid-1,B,'AMBIENT_ONLY')
        flags=[bool(mask & (1<<bit)) for bit in range(3)]
        profile.update(zip(('personOn','groupOn','backgroundOn'),flags));profile['memory']=any(flags)
        n=len(seen);client.calls=[];await turn(mid);assert len(seen)==n+1
        text=user_payload(seen[-1]);body=json.dumps(seen[-1],ensure_ascii=False)
        rows=json.JSONDecoder().raw_decode(text[len(pm.HEADER):])[0] if text.startswith(pm.HEADER) else {}
        for enabled,key,marker in zip(flags,('person','group','background'),('SIMPLEX_ANSWER_109','VENICE_ANSWER_2149','AMBIENT_ONLY')):
            assert (key in rows)==enabled and (marker in body)==enabled,(mask,key)
        assert 'LEGACY_ROOM_HISTORY' not in body and profile['personLimit']==100
        if mask==0:assert not client.calls,'all paused: no history reads'
        if mask==4:assert client.calls==[(peer,None,None,1)],'BG only must not fetch a dialogue'


class Memory(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.db=sqlite3.connect(self.root/'state.sqlite');self.db.execute('PRAGMA synchronous=OFF');self.addCleanup(self.db.close);self.client=Client()
    async def get(self,actor=A,peer=ROOM,before=99999,quote=None,**changes):
        return await pm.group_context(self.client,self.db,peer,actor,before,quote,{**DEFAULT,**changes})
    async def test_verified_circle_windows(self):
        import circle_transcripts as ct
        self.client.pair(self.db,ROOM,A,20,'speech'); m=self.client.rows[ROOM,21]
        m.video_note=True; m.raw_text=m.message=''
        ct.configure(lambda p,i,r:'actual speech' if (p,i,r)==(ROOM,21,20) else '');self.addCleanup(ct.configure,None)
        for opts in ({},{'actor':B,'personLimit':0,'memoryLimit':1},{'personLimit':0,'backgroundLimit':1}):
            self.assertIn('actual speech',await self.get(personOn=True,groupOn=True,backgroundOn=True,**opts))
        self.assertNotIn('actual speech',await self.get(quote=21));self.assertEqual(pm.message_text(m),'actual speech')
        m.fwd_from=True;self.assertEqual(pm.message_text(m),'');m.fwd_from=None
        del self.client.rows[ROOM,21];self.assertNotIn('actual speech',await self.get())

    def fill(self):
        for i in range(1,111,2):self.client.pair(self.db,ROOM,A,i,'SIMPLEX')
        for i in range(151,2151,2):self.client.pair(self.db,ROOM,B,i,'VENICE')
        self.client.pair(self.db,OTHER,A,11,'FOREIGN')
    async def test_quiet_sender_after_a_thousand_other_turns_and_restart(self):
        self.fill();other=sqlite3.connect(self.root/'state.sqlite');self.addCleanup(other.close)
        p=await pm.group_context(self.client,other,ROOM,A,99999,None,DEFAULT);rows=packed(p)['person']
        self.assertEqual([r['id'] for r in rows],list(range(11,111)));self.assertNotIn('VENICE',p);self.assertNotIn('FOREIGN',p)
        self.assertEqual(rows[-1]['role'],'assistant');self.assertTrue(all(peer==ROOM for peer,*_ in self.client.calls))
        self.assertTrue(all(call[2] is not None for call in self.client.calls),'warm personal read must not fetch the room feed')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM participant_replies WHERE peer=? AND actor=?',(ROOM,B)).fetchone()[0],500)
        self.assertNotIn('text',[r[1] for r in self.db.execute('PRAGMA table_info(participant_replies)')])
    async def test_three_independent_windows_and_quote_dedup(self):
        self.client.pair(self.db,ROOM,A,10,'SIMPLEX');self.client.pair(self.db,ROOM,B,15,'VENICE');self.client.post(ROOM,17,B,'AMBIENT');self.client.post(ROOM,18,B,'EXPLICIT')
        w=packed(await self.get(quote=18,personLimit=1,memoryLimit=2,backgroundLimit=4))
        self.assertEqual([r['id'] for r in w['person']],[11]);self.assertEqual([r['id'] for r in w['group']],[15,16]);self.assertEqual([r['id'] for r in w['background']],[17]);self.assertNotIn('EXPLICIT',str(w));
        self.assertNotIn('SIMPLEX',await self.get(actor=B));self.assertNotIn('person',packed(await self.get(actor=-17)))
    async def test_deleted_edited_reset_mismatch_and_disabled(self):
        c=self.client;c.pair(self.db,ROOM,A,10,'old');c.pair(self.db,ROOM,A,20,'new');c.pair(self.db,ROOM,A,30,'gone');del c.rows[ROOM,30]
        c.post(ROOM,20,A,'edited');c.pair(self.db,ROOM,A,40,'wrong_parent');c.rows[ROOM,41].reply_to_msg_id=15
        c.pair(self.db,ROOM,A,50,'wrong_author');c.rows[ROOM,50].sender_id=B
        c.pair(self.db,ROOM,A,60,'foreign_parent');c.rows[ROOM,61].reply_to=N(reply_to_peer_id=__import__('telethon').types.PeerUser(123))
        p=await self.get(memoryResetAt=15000);self.assertIn('edited',p)
        for forbidden in ('old_QUESTION','old_ANSWER','gone','wrong_parent','wrong_author','foreign_parent'):self.assertNotIn(forbidden,p)
        self.assertIn('old_QUESTION',await self.get(memoryResetAt=0));c.calls=[]
        self.assertFalse(await self.get(memory=False));self.assertFalse(await self.get(personLimit=0));self.assertFalse(c.calls)
        with patch.object(c,'get_messages',new=AsyncMock(side_effect=OSError())):self.assertFalse(await self.get())
    async def test_paused_counts_and_stale_legacy_gate(self):
        p=dict(DEFAULT,memoryLimit=2,backgroundLimit=1,personOn=False,groupOn=False,backgroundOn=False)
        self.assertTrue(pm.uses_group_windows(p));self.assertEqual(pm.group_limits(p),(0,0,0));self.assertEqual(p['personLimit'],100)
        self.assertFalse(await pm.group_context(self.client,self.db,ROOM,A,100,None,p));self.assertEqual(self.client.calls,[])
        p.update(memory=False,groupOn=True);self.assertEqual(pm.group_limits(p),(0,2,0))
        del p['personOn'];self.assertRaises(ValueError,pm.group_limits,p)
    async def test_bounded_cold_start_and_payload_size(self):
        self.client.pair(self.db,ROOM,A,1,'SIMPLEX',False);self.client.pair(self.db,ROOM,B,3,'VENICE',False)
        p=await self.get();self.assertIn('SIMPLEX_ANSWER',p);self.assertNotIn('VENICE',p);self.assertLessEqual(len(self.client.calls),3)
        self.client.calls=[];await self.get();self.assertEqual(len(self.client.calls),1)
        for i in range(6,30,2):self.client.pair(self.db,ROOM,A,i,'🌗'*12000)
        p=await self.get();self.assertLessEqual(len(p.split('\n',1)[1].encode()),pm.TOTAL_BYTES)
        self.assertLess(len(packed(p)['person']),26)
    @unittest.skipUnless(os.environ.get('TEST_PI_BIN'),'set TEST_PI_BIN for the real loopback-provider fixture')
    async def test_real_pi_provider_payload(self):
        base=self.root/'state';base.mkdir();state=PeerState(base,ROOM);state.db.execute('PRAGMA synchronous=OFF');self.addCleanup(state.db.close)
        for i in range(1,111,2):self.client.pair(state.db,ROOM,A,i,'SIMPLEX')
        for i in range(151,2151,2):self.client.pair(state.db,ROOM,B,i,'VENICE')
        current=self.client.post(ROOM,2155,A,'@nika Continue the simplex');profile={**DEFAULT,'model':'fixture/test','thinking':'off','toolsOn':False,'basePrompt':'A synthetic test.'}
        send=AsyncMock(return_value=[]);g=Group(self.client,await self.client.get_me(),ROOM,'lake',state,lambda *_:(profile,'all',[]),instance.answer,send)
        with local_provider(self.root) as seen,patch.object(instance,'BASE',base),patch.dict(os.environ,{'PI_WEB_PI_BIN':os.environ['TEST_PI_BIN']}):
            await g.handle(current)
            self.assertEqual(len(seen),1);body=json.dumps(seen[0],ensure_ascii=False)
            self.assertIn('SIMPLEX_ANSWER_109',body);self.assertIn('SIMPLEX_QUESTION_11',body);self.assertNotIn('SIMPLEX_QUESTION_1\\"',body);self.assertNotIn('VENICE',body)
            self.assertEqual([x['id'] for x in packed(user_payload(seen[0]).split('\n\nCurrent request:',1)[0])['person']],list(range(11,111)))
            self.assertEqual(send.await_count,1)
            # Positive Group must still not resume a shared Pi session in scoped mode.
            profile['memoryLimit']=2;await g.handle(self.client.post(ROOM,2157,A,'@nika group too'))
            self.assertIn('VENICE_ANSWER_2149',json.dumps(seen[-1]));self.assertFalse(list((base/f'conversation-group-{ROOM}').rglob('*.jsonl')))
            # First create a real legacy Pi session. No explicit switch mask may resume it.
            profile['personLimit']=0;await g.handle(self.client.post(ROOM,2160,A,'LEGACY_ROOM_HISTORY'))
            self.assertIn('LEGACY_ROOM_HISTORY',user_payload(seen[-1]))
            async def turn(mid):await g.handle(self.client.post(ROOM,mid,A,'@nika current request'))
            await exercise_switches(self.client,ROOM,2200,profile,turn,seen)
            profile.update(personOn=False,groupOn=False,backgroundOn=False,memory=False)
            await g.handle(self.client.post(ROOM,2300,A,'@nika explicitly quoting',2149))
            t=user_payload(seen[-1]);self.assertIn('VENICE_QUESTION_2149',t);self.assertNotIn('VENICE_ANSWER',t);self.assertNotIn(pm.HEADER,t)


if __name__=='__main__':unittest.main()
