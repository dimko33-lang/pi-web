"""Offline Telegram history, real per-peer SQLite, controllable clock, two process lifetimes."""
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'telegram'))
from group_replies import Group, PeerState
from salon_archive import bind, read


class Client:
    def __init__(self): self.log = []
    def add(self, text, at, out=False, reply=None):
        mid = len(self.log)+1
        msg = NS(id=mid, chat_id=-7, raw_text=text, out=out, sender_id=9 if out else 12, entities=[],
                 reply_to_msg_id=reply, date=datetime.fromtimestamp(at, timezone.utc))
        async def target(): return await self.get_messages(-7, ids=reply)
        msg.get_reply_message = target
        self.log.append(msg); return msg
    async def get_messages(self, peer, ids=None, min_id=0, limit=1, reverse=False, offset_date=None):
        assert peer == -7
        if ids: return next((m for m in self.log if m.id == ids), None)
        rows = [m for m in self.log if m.id > min_id and (not offset_date or m.date < offset_date)]
        return (rows if reverse else rows[::-1])[:limit]
    @asynccontextmanager
    async def action(self, peer, kind): yield


class Recovery(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); self.base = Path(tmp.name)
        clock = patch('time.time', return_value=10000); self.now = clock.start(); self.addCleanup(clock.stop)
        self.c = Client(); self.sent = []; self.calls = []; self.mode = 'mention_reply'; self.fail = False
    async def boot(self):
        state = PeerState(self.base,-7); self.addCleanup(state.db.close)
        async def infer(text, profile, peer, addressing):
            self.calls.append((text,peer,addressing))
            if self.fail: raise RuntimeError('provider offline')
            return 'answer'
        async def send(msg, text): self.sent.append(msg.id); self.c.add(text,10000,out=True,reply=msg.id)
        g = Group(self.c,NS(id=9,username='my_agent'),-7,'lightcone',state,
                  lambda *_: ({},self.mode,['Nikita']),infer,send)
        await g.start();return g
    async def test_down_and_up(self):
        self.c.add('@my_agent historical',10000); g = await self.boot(); await g.step(); self.assertFalse(self.calls)
        g.state.db.close(); self.c.add('@my_agent question',10000); self.c.add('@my_agent2 wrong',10000)
        self.c.add('@my_agent other question',10000); self.c.add('manual',10000,True,4)
        g=await self.boot(); await g.step(); await g.step(); self.assertEqual(self.sent,[2]); self.assertEqual(len(self.calls),1)
        g.state.db.close(); g=await self.boot();await g.step();self.assertEqual(self.sent,[2])
        self.c.add('reply to account',10000,reply=5);await g.step();self.assertEqual(self.sent,[2,7])
    async def test_bounded_retry_survives_restart(self):
        g=await self.boot();self.c.add('@my_agent first',10000);self.fail=True
        with self.assertRaises(RuntimeError):await g.step()
        g.state.db.close();self.now.return_value=10031;self.fail=False;g=await self.boot();await g.step();await g.step()
        self.assertEqual(self.sent,[1]);self.assertEqual(len(self.calls),2)
    async def test_expiry_mode_and_silence(self):
        g=await self.boot();g.state.db.close();self.c.add('@my_agent expired',6000);self.c.add('ordinary',10000)
        self.mode='all';g=await self.boot();await g.step();self.assertFalse(self.calls)
        self.mode='off';self.c.add('@my_agent muted',10000);await g.step();self.assertFalse(self.calls)
        self.mode='addressed';self.c.add('Nikita?',10000);await g.step();self.assertTrue(self.calls[-1][2]);self.assertEqual(self.calls[-1][1],-7)
    async def test_only_addressed_group_turn_samples_reply(self):
        g=await self.boot(); gif=self.c.add('',10000); gif.file=NS(mime_type='image/gif',size=20)
        seen=[]
        @asynccontextmanager
        async def sample(*messages):
            seen.append(messages); yield ['sample.jpg'],'ordered samples'
        async def infer(text,profile,peer,address,*,frames):
            self.assertEqual(frames,['sample.jpg']); self.assertIn('ordered samples',text); return 'ok'
        g.infer=infer
        with patch('group_replies.sampled_inputs',sample):
            await g.step(); self.assertFalse(seen)
            ask=self.c.add('@my_agent what happened?',10000,reply=gif.id);await g.step()
            self.assertEqual(seen,[(ask,gif)]);self.assertEqual(self.sent,[ask.id])
    async def test_voice_direct_quote_and_privacy(self):
        g=await self.boot(); self.c.download_media=object(); seen=[]
        async def context(m,download,*,quoted,on_current_speech=None):seen.append((m.id,quoted));return 'heard the recital'
        with patch('group_replies.audio_context',context):
            file=self.c.add('',10000);file.file=NS(mime_type='application/octet-stream',name='recital.OGG');await g.step();self.assertFalse(seen)
            req=self.c.add('@my_agent repeat that',10000,reply=file.id);await g.step();self.assertEqual(seen,[(file.id,True)]);self.assertIn('heard the recital',self.calls[-1][0])
            voice=self.c.add('',10000,reply=self.sent[-1]+1);voice.voice=True;await g.step();self.assertEqual(seen[-1],(voice.id,False))
            file.chat_id=-44;self.c.add('@my_agent foreign',10000,reply=file.id);await g.step();self.assertEqual(len(seen),2)
            self.mode='off';m=self.c.add('@my_agent',10000);m.voice=True;await g.step();self.assertEqual(len(seen),2)

    async def test_group_spoken_reply_not_quoted_or_sticky(self):
        g=await self.boot();self.c.download_media=object();sent=[]
        async def send(m,text,*,spoken=False):sent.append((m.id,spoken))
        g.send=send
        from unittest.mock import AsyncMock
        with patch('voice_notes.recognize',new=AsyncMock(return_value='Никита, поговори со мной.')) as asr:
            a=self.c.add('@my_agent поговори со мной, пожалуйста',10000);await g.step()
            v=self.c.add('@my_agent',10000);v.voice=True;await g.step()
            q=self.c.add('@my_agent о чём запись?',10000,reply=v.id);await g.step()
            f=self.c.add('@my_agent поговори со мной',10000);f.fwd_from=True;await g.step()
            m=self.c.add('другой разговор',10000);m.voice=True;await g.step()
            self.assertEqual(sent,[(a.id,True),(v.id,True),(q.id,False),(f.id,False)]);self.assertEqual(asr.await_count,2)
    def test_archive_does_not_grant_replies(self):
        bind(self.base,'lightcone',-7,True);p=self.base/'reply-bindings.json';self.assertFalse(p.exists())
        bind(self.base,'lightcone',-7,replies=True);self.assertEqual(read(p,{}),{'lightcone':-7})
        bind(self.base,'lightcone',-7,replies=False);self.assertEqual(read(p,{}),{});self.assertEqual(read(self.base/'archive-bindings.json',{}),{'lightcone':-7})


if __name__=='__main__': unittest.main()
