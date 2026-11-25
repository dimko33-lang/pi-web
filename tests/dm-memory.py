"""Private Dialogue at Telegram ingress and on Pi's actual HTTP request. No Telegram connection."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import AsyncMock, patch
from loopback_provider import local_provider, user_payload

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
import dm_memory as dm
import instance
from telethon.tl.types import PeerUser

OWNER, GUEST, STRANGER, ME = 21, 22, 23, 24


class Client:
    def __init__(self): self.rows={}; self.reads=[]
    def post(self, peer, mid, text, *, parent=None, out=False):
        m=N(id=mid, chat_id=peer, sender_id=ME if out else peer, out=out, is_private=True, reply_to_msg_id=parent,
            reply_to=None, raw_text=text, message=text, date=datetime.fromtimestamp(mid,timezone.utc), fwd_from=None, media=None)
        self.rows[peer,mid]=m
        return m
    def event(self, m):
        return N(**{k:getattr(m,k) for k in ('id','chat_id','sender_id','out','is_private','raw_text')}, message=m, client=self,
                 get_reply_message=AsyncMock(side_effect=lambda:self.rows.get((m.chat_id,m.reply_to_msg_id))))
    async def get_messages(self, peer, ids=None, max_id=None, limit=None):
        self.reads.append(peer)
        if ids is not None: return [self.rows.get((peer,i)) for i in ids]
        return sorted((m for (p,i),m in self.rows.items() if p==peer and i<max_id),key=lambda m:-m.id)[:limit]


def history(text):
    return json.JSONDecoder().raw_decode(text[len(dm.HEADER):])[0] if text.startswith(dm.HEADER) else []


class Dialogue(unittest.IsolatedAsyncioTestCase):
    async def test_visible_only(self):
        c=Client();p=OWNER;profile={'memoryLimit':500}
        for n in range(1,18,2): c.post(p,n,'Q'+str(n));c.post(p,n+1,'A'+str(n),parent=n,out=True)
        del c.rows[p,3];c.rows[p,5].raw_text='EDITED';c.rows[p,7].sender_id=STRANGER;c.rows[p,10].reply_to=N(reply_to_peer_id=PeerUser(STRANGER))
        c.rows[p,11].chat_id=STRANGER;c.rows[p,13].raw_text='/join CONTROL';c.rows[p,16].reply_to_msg_id=None
        c.post(p,30,'Unanswered');c.post(p,31,'Unthreaded',out=True);c.post(STRANGER,17,'FOREIGN');e=c.event(c.post(p,40,'NOW'))
        rows=history(await dm.dm_context(e, profile, 17)); self.assertEqual([r['text'] for r in rows],['Q1','A1','EDITED','A5','A17'])
        self.assertEqual([r['text'] for r in history(await dm.dm_context(e,{**profile,'memoryResetAt':17000}))],['Q17','A17'])
        c.reads.clear();self.assertEqual(await dm.dm_context(e,{**profile,'memory':False}),'');self.assertEqual(await dm.dm_context(e,{'memoryLimit':0}),'');self.assertFalse(c.reads)
        for attr, value in [('chat_id',-22),('sender_id',23),('is_private',False),('out',True)]:
            with patch.object(e,attr,value): self.assertEqual(await dm.dm_context(e,profile),'')
        self.assertFalse(c.reads)
        with patch.object(c,'get_messages',AsyncMock(side_effect=OSError())): self.assertEqual(await dm.dm_context(e,profile),'')
        c.rows[p,18].raw_text='🌗'*90000;self.assertFalse(await dm.dm_context(e,profile))

    @unittest.skipUnless(os.environ.get('TEST_PI_BIN'),'set TEST_PI_BIN to verify the actual HTTP request')
    async def test_provider_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data=root/'data';data.mkdir();base=root/'state';base.mkdir();c=Client()
            settings={p:dict(model='fixture/test',toolsOn=False,memory=True,memoryLimit=500,basePrompt=f'PROFILE_{p}') for p in (OWNER,GUEST)}
            def save(): (data/'conversation-profiles.json').write_text(json.dumps({'version':1,'profiles':{'owner_dm':settings[OWNER],f'dm_{GUEST}':settings[GUEST]}}))
            async def turn(peer, mid, label, expected, quote=None):
                save();c.reads.clear();e=c.event(c.post(peer,mid,label,parent=quote));n=len(seen)
                result,photo=await instance.tool_turn(e,guest=None if peer==OWNER else peer)
                self.assertEqual(len(seen),n+1);self.assertEqual(result,'REPLY_'+str(n+1));self.assertIsNone(photo)
                c.post(peer,mid+1,result,parent=mid,out=True)
                req=seen[-1];text=user_payload(req);self.assertEqual([r['text'] for r in history(text)],expected)
                self.assertEqual([m['role'] for m in req['messages'] if m['role']!='system'],['user'])
                body=json.dumps(req); self.assertIn(f'PROFILE_{peer}',body); self.assertNotIn(f'PROFILE_{GUEST if peer==OWNER else OWNER}',body)
                if peer==GUEST: self.assertNotIn('FOREIGN_PEER',body)
                self.assertTrue(all(p==peer for p in c.reads));return text
            env={'PI_WEB_PI_BIN':os.environ['TEST_PI_BIN'],'PI_WEB_TELEGRAM_DATA':str(data)}
            with local_provider(root,lambda i:'REPLY_'+str(i)) as seen, patch.dict(os.environ,env), patch.object(instance,'BASE',base):
                await turn(GUEST,10,'ONE',[]);await turn(OWNER,10,'FOREIGN_PEER',[])
                await turn(GUEST,20,'TWO',['ONE','REPLY_1']);settings[GUEST]['memoryLimit']=1
                text=await turn(GUEST,30,'THREE',['REPLY_3']);self.assertNotIn('ONE',text);self.assertNotIn('TWO',text)
                settings[GUEST].update(memory=False,memoryLimit=500);await turn(GUEST,40,'PAUSED',[],10);self.assertFalse(c.reads);self.assertEqual(user_payload(seen[-1]).count('ONE'),1)
                settings[GUEST].update(memory=True,memoryLimit=0);await turn(GUEST,50,'ZERO',[]);self.assertFalse(c.reads)
                settings[GUEST].update(memoryLimit=500,memoryResetAt=50000);await turn(GUEST,60,'NEW',['ZERO','REPLY_6'])
                settings[GUEST]['memoryResetAt']=0;rows=['REPLY_1','TWO','REPLY_3','THREE','REPLY_4','PAUSED','REPLY_5','ZERO','REPLY_6','NEW','REPLY_7']
                text=await turn(GUEST,70,'OLD',rows,10);self.assertEqual(text.count('ONE'),1)
                settings[OWNER]['memoryLimit']=1;await turn(OWNER,80,'OWNER_ONLY',['REPLY_2'])
                self.assertFalse(list(base.rglob('*.jsonl')))
                # A large quota counts both roles, never 500 pairs. No model turns needed to seed the fixture.
                want=[]
                for n in range(100,606,2):
                    q,a=f'Q{n}',f'A{n}';c.post(GUEST,n,q);c.post(GUEST,n+1,a,parent=n,out=True);want.extend((q,a))
                await turn(GUEST,700,'FULL_WINDOW',want[-500:]);self.assertEqual(len(seen),10)


if __name__=='__main__': unittest.main()
