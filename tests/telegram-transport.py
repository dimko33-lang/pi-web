"""Offline smoke tests. Run with the installer's Telegram venv Python."""
import asyncio
import json
from unittest.mock import patch
from pathlib import Path
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
import instance
from telegram_blocks import message_parts


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
            pi.write_text('#!' + sys.executable + '\nimport json,sys,pathlib\na=sys.argv[1:]; p=next((a[a.index(k)+1] for k in ("--system-prompt","--append-system-prompt") if k in a),None);print(json.dumps([a, pathlib.Path(p).read_text() if p else None, sys.stdin.read()]))')
            pi.chmod(0o700)
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
                self.assertEqual(Path(args[args.index('--session-dir')+1]).name, 'after-300')

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
            p = root / 'fake-pi'; p.write_text('#!/bin/sh\ncase " $* " in *" --no-tools "*) cat;; *) exit 2;; esac\n'); p.chmod(0o700)
            (root / 'data').mkdir(); (root / 'data/browser-model.txt').write_text('test/model')
            os.environ['PI_WEB_PI_BIN'] = str(p)
            with instance.exclusive():
                with self.assertRaisesRegex(SystemExit, 'Another process'):
                    with instance.exclusive(): pass
                self.assertEqual(asyncio.run(instance.answer('@local-file --option')), '@local-file --option')
            self.assertFalse(instance.CONFIG.exists())

if __name__ == '__main__': unittest.main()
