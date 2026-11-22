#!/usr/bin/env python3
"""Portable, explicitly enrolled Telegram transport for a single owner's DMs."""
import argparse
import asyncio
from contextlib import contextmanager
import fcntl
from getpass import getpass
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

from telethon import TelegramClient, errors, events
from telethon.sessions import StringSession
from telegram_blocks import message_parts, verify_blocks

APP = Path(__file__).resolve().parent.parent
BASE = Path(os.environ.get('NIKITA_INSTANCE_DIR', str(APP.parent / 'telegram-state'))).resolve()
CONFIG = BASE / 'connection.json'


@contextmanager
def exclusive():
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (BASE / 'instance.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another process owns this Telegram instance.')
        yield


async def enroll():
    if CONFIG.exists():
        raise SystemExit('Already connected. Existing credentials were not changed.')
    api = int(input('Telegram application API ID: ').strip())
    secret = getpass('Telegram application API hash: ').strip()
    owner = int(input('Your personal Telegram user ID (allowed sender): ').strip())
    if api <= 0 or owner <= 0 or not re.fullmatch('[a-fA-F0-9]{32}', secret):
        raise SystemExit('Invalid Telegram application or owner ID.')
    c = TelegramClient(StringSession(), api, secret)
    await c.connect()
    try:
        import qrcode
        print('On the agent account: Telegram > Settings > Devices > Link Desktop Device.')
        for _ in range(8):
            qr = await c.qr_login(); image = qrcode.QRCode(border=4); image.add_data(qr.url)
            image.print_ascii(invert=True)
            try:
                await qr.wait()
            except asyncio.TimeoutError:
                continue
            except errors.SessionPasswordNeededError:
                await c.sign_in(password=getpass('Telegram two-step password: '))
            break
        else:
            raise SystemExit('QR expired. Nothing saved.')
        me = await c.get_me()
        if not me or me.bot or me.id == owner:
            await c.log_out(); raise SystemExit('Use a separate agent account, not the owner account.')
        if input(f'Connect account {me.id} to owner {owner}? [y/N] ').strip().lower() != 'y':
            await c.log_out(); raise SystemExit('Cancelled. Nothing saved.')
        with tempfile.NamedTemporaryFile('w', dir=BASE, delete=False) as out:
            json.dump(dict(api=api, secret=secret, owner=owner, account=me.id, session=c.session.save()), out)
            out.flush(); os.fsync(out.fileno())
        os.replace(out.name, CONFIG)
    finally:
        await c.disconnect()
    print('Telegram connected.')


def owner_dm(e, owner):
    return bool(e.is_private and not e.out and e.sender_id == owner and e.chat_id == owner and (e.raw_text or '').strip())


async def answer(text):
    pi = os.environ.get('PI_WEB_PI_BIN') or shutil.which('pi')
    if not pi:
        raise RuntimeError('Pi CLI not found')
    cwd = BASE / 'conversation'; cwd.mkdir(mode=0o700, exist_ok=True)
    args = [pi, '--print', '--no-context-files', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-tools', '--session-dir', str(cwd), '--continue']
    model = APP / 'data/browser-model.txt'
    if model.is_file() and model.read_text().strip():
        args.extend(['--model', model.read_text().strip()])
    # Use stdin, never interpret Telegram text as a path, shell or CLI option.
    p = await asyncio.create_subprocess_exec(*args, cwd=cwd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        data, _ = await asyncio.wait_for(p.communicate(text.encode()), 360)
    finally:
        if p.returncode is None:
            p.kill(); await p.wait()
    if p.returncode or not data.strip():
        raise RuntimeError('Pi returned no reply')
    return data.decode(errors='replace').strip()


async def serve():
    if not CONFIG.is_file():
        raise SystemExit('Telegram not connected; run connect first.')
    conf = json.loads(CONFIG.read_text()); owner = conf['owner']
    c = TelegramClient(StringSession(conf['session']), conf['api'], conf['secret'], sequential_updates=True)
    @c.on(events.NewMessage(incoming=True, from_users=[owner]))
    async def incoming(e):
        if not owner_dm(e, owner):
            return
        try:
            async with c.action(owner, 'typing'):
                text = await answer(e.raw_text)
        except (RuntimeError, OSError, asyncio.TimeoutError):
            await e.reply('Pi could not complete this reply. Check provider login and selected model.'); return
        for body, entities in message_parts(text, formatted=True):
            sent = await e.reply(body, formatting_entities=entities, link_preview=False)
            await verify_blocks(c, owner, sent, entities)
    try:
        await c.connect()
        me = await c.get_me()
        if not me or me.id != conf['account']:
            raise SystemExit('Telegram account mismatch or expired authorization.')
        await c.run_until_disconnected()
    finally:
        await c.disconnect()


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['connect', 'run', 'status'])
    action = parser.parse_args().action
    if action == 'status':
        print('Connected' if CONFIG.is_file() else 'Installed; not connected')
    else:
        with exclusive():
            asyncio.run(enroll() if action == 'connect' else serve())
