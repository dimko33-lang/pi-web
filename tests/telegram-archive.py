"""Synthetic Telegram history. No network, identity or provider credentials."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'telegram'))
import salon_archive as archive


class Message:
    def __init__(self, n, outgoing=True, photo=False):
        self.id=n; self.date=datetime.now(timezone.utc); self.message=f'text {n}'; self.out=outgoing; self.photo=photo; self.sender_id=7 if outgoing else 8
    async def get_sender(self): return SimpleNamespace(first_name='Test', last_name='')


class Client:
    def __init__(self): self.rows=[Message(1)]; self.fail=False
    async def get_messages(self, peer, limit, min_id=None, max_id=None, reverse=False):
        if min_id is None: return self.rows[-1:]
        assert reverse
        return [m for m in self.rows if min_id<m.id<max_id][:limit]
    async def download_media(self, msg, file):
        if self.fail: raise ConnectionError()
        file.write(b'\xff\xd8\xff\xd9')


class Archive(unittest.IsolatedAsyncioTestCase):
    async def test_filter_resume_and_no_replay_of_old_history(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t); client=Client(); p=-100123; archive.bind(base,'lightcone',p,True)
            with self.assertRaises(ValueError): archive.bind(base,'lightcone',-3)
            with self.assertRaises(ValueError): archive.bind(base,'lake',p)
            with self.assertRaises(ValueError): archive.bind(base,'owner_dm',7)
            a=archive.SalonArchive(base,17); dest=base/'archive/lightcone'; await a.page(client,'lightcone',p)
            self.assertFalse((dest/'messages.json').exists())
            client.rows.extend([Message(2,False),Message(3,True,True)])
            client.fail=True
            with self.assertRaises(ConnectionError): await a.page(client,'lightcone',p)
            self.assertEqual(archive.read(dest/'cursor.json',{})['last'],1)
            client.fail=False; await a.page(client,'lightcone',p)
            self.assertEqual([r['original']['id'] for r in archive.read(dest/'messages.json',[])],[3]); self.assertTrue((dest/'100123-3.jpg').exists())
            self.assertEqual([r['id'] for r in archive.read(base/'authors/user8.json',[])],[2])
            # Replay after a simulated crash just before cursor commit.
            archive.atomic(dest/'cursor.json',{'peer':p,'last':1}); a=archive.SalonArchive(base,17)
            await a.page(client,'lightcone',p); self.assertEqual(len(archive.read(dest/'messages.json',[])),1)
            self.assertEqual(len(archive.read(base/'authors/user8.json',[])),1)
            client.rows += [Message(i) for i in range(4,115)]
            await a.page(client,'lightcone',p); self.assertTrue(a.wake.is_set());await a.page(client,'lightcone',p)
            self.assertEqual(archive.read(dest/'cursor.json',{})['last'],114)

    async def test_owner_feed_not_in_author_index(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t); c=Client(); a=archive.SalonArchive(base,17);await a.page(c,'owner_dm',17)
            c.rows += [Message(2,False),Message(3)];await a.page(c,'owner_dm',17)
            self.assertEqual(len(archive.read(base/'archive/owner_dm/messages.json',[])),1)
            self.assertFalse((base/'authors').exists())

if __name__=='__main__': unittest.main()
