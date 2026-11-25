"""Offline smoke tests. Run with the installer's Telegram venv Python."""
import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from pathlib import Path
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
import instance
from telegram_blocks import message_parts


def fake_pi(path, expression):
    path.write_text('#!' + sys.executable + '\nimport json,sys,pathlib\na=sys.argv[1:]\n'
        'assert "--no-tools" in a and a[a.index("--mode")+1]=="json"\n'
        'p=next((a[a.index(k)+1] for k in ("--system-prompt","--append-system-prompt") if k in a),None)\n'
        'result=' + expression + '\nprint(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":result}]}}))\n'
        'print(json.dumps({"type":"agent_settled"}))\n')
    path.chmod(0o700)


class Transport(unittest.TestCase):
    def test_only_owner_dm(self):
        fields = dict(is_private=True, out=False, sender_id=17, chat_id=17, raw_text='hello')
        self.assertTrue(instance.owner_dm(SimpleNamespace(**fields), 17))
        for overrides in [dict(is_private=False), dict(out=True), dict(chat_id=-2), dict(sender_id=3), dict(raw_text=' ')]:
            self.assertFalse(instance.owner_dm(SimpleNamespace(**{**fields, **overrides}), 17))

    def test_owner_profile_is_pinned_and_applied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'state').mkdir(); (root / 'data').mkdir()
            pi = root / 'fake-pi'
            fake_pi(pi, 'json.dumps([a, pathlib.Path(p).read_text() if p else None, sys.stdin.read()])')
            profile = dict(model='test/subscription', thinking='low', memory=False, piOn=False, toolsOn=False,
                           basePrompt='@literal', character='unused', systemPrompt=False, tail='brief', tailOn=True)
            store = root / 'data/conversation-profiles.json'
            def save():
                store.write_text(json.dumps(dict(version=1, profiles=dict(owner_dm=profile, guest_dm=dict(basePrompt='other')))))
            with patch.object(instance, 'BASE', root / 'state'), patch.object(instance, 'APP', root), patch.dict(os.environ, PI_WEB_PI_BIN=str(pi), PI_WEB_TELEGRAM_DATA=str(root/'data')):
                save()
                args, prompt, text = json.loads(asyncio.run(instance.answer('hello')))
                self.assertEqual(args[args.index('--model')+1], 'test/subscription')
                self.assertEqual(args[args.index('--thinking')+1], 'low')
                self.assertIn('--no-session', args); self.assertIn('--system-prompt', args)
                self.assertEqual(prompt, '@literal'); self.assertTrue(text.startswith('hello')); self.assertIn('brief', text)
                self.assertFalse(Path(args[args.index('--system-prompt')+1]).exists())
                response = asyncio.run(instance.tool_turn(SimpleNamespace(raw_text='/image an owl')))
                self.assertIn('off', response[0]); self.assertFalse((root/'state/tool-turns.sqlite').exists())
                profile.update(piOn=True, memory=True, memoryResetAt=300, tailOn=False); save()
                args, prompt, text = json.loads(asyncio.run(instance.answer('hello')))
                self.assertIn('--append-system-prompt', args); self.assertEqual(prompt, '@literal'); self.assertEqual(text, 'hello')
                self.assertIn('--no-session', args); self.assertNotIn('--continue', args)

    def test_dm_stall_notice_not_generic_failure(self):
        # Exercise the registered incoming handler, not an actual Telegram session.
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp); config=base/'fixture.json'
            config.write_text(json.dumps(dict(owner=17,account=18,session='',api=1,secret='fixture')))
            event=SimpleNamespace(chat_id=17,is_private=True,out=False,sender_id=17,raw_text='Hello',message=SimpleNamespace(),reply=AsyncMock())
            class Client:
                def on(self,*args):
                    def register(handler): self.last=handler; return handler
                    return register
                connect=AsyncMock(); disconnect=AsyncMock(); get_me=AsyncMock(return_value=SimpleNamespace(id=18))
                async def run_until_disconnected(self): await self.last(event)
                @asynccontextmanager
                async def action(self,*args): yield
            with patch.object(instance,'BASE',base), patch.object(instance,'CONFIG',config), patch.object(instance,'StringSession'), patch.object(instance,'TelegramClient',return_value=Client()), patch.object(instance.SalonArchive,'run',AsyncMock()), patch.object(instance.GroupService,'run',AsyncMock()), patch.object(instance,'tool_turn',AsyncMock(side_effect=instance.PiIdleTimeout(1200))):
                asyncio.run(instance.serve())
            event.reply.assert_awaited_once_with('Pi produced no progress for 1200 seconds. This request was stopped.')

    def test_unicode_limits(self):
        text = '🌙' * 4000
        parts = list(message_parts(text, formatted=True))
        self.assertEqual(''.join(s for s, _ in parts), text)
        self.assertTrue(all(len(s.encode('utf-16-le')) // 2 <= 3900 for s, _ in parts))

    def test_no_session_no_connection_and_private_model_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.addCleanup(setattr, instance, 'BASE', instance.BASE)
            self.addCleanup(setattr, instance, 'CONFIG', instance.CONFIG)
            self.addCleanup(setattr, instance, 'APP', instance.APP)
            instance.BASE = root / 'state'; instance.CONFIG = instance.BASE / 'connection.json'; instance.APP = root
            with self.assertRaisesRegex(SystemExit, 'not connected'):
                asyncio.run(instance.serve())
            previous = os.environ.get('PI_WEB_PI_BIN')
            self.addCleanup(lambda: os.environ.pop('PI_WEB_PI_BIN', None) if previous is None else os.environ.update(PI_WEB_PI_BIN=previous))
            p = root / 'fake-pi'; fake_pi(p, 'sys.stdin.read()')
            (root / 'data').mkdir(); (root / 'data/browser-model.txt').write_text('test/model')
            os.environ['PI_WEB_PI_BIN'] = str(p)
            with instance.exclusive():
                with self.assertRaisesRegex(SystemExit, 'Another process'):
                    with instance.exclusive(): pass
                self.assertEqual(asyncio.run(instance.answer('@local-file --option')), '@local-file --option')
            self.assertFalse(instance.CONFIG.exists())

if __name__ == '__main__': unittest.main()
