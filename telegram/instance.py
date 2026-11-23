#!/usr/bin/env python3
"""Portable, explicitly enrolled Telegram transport for a single owner's DMs."""
import argparse
import base64
import io
import sqlite3
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
from salon_archive import SalonArchive, bind, GROUPS, read
from group_replies import GroupService
from motion_frames import attachment_type, sampled_inputs, PHOTOS

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
    # Optionally provision application metadata privately, never ship it in the repo.
    api = int((os.environ.get('TELEGRAM_API_ID') or input('Telegram application API ID: ')).strip())
    secret = (os.environ.get('TELEGRAM_API_HASH') or getpass('Telegram application API hash: ')).strip()
    owner = int((os.environ.get('NIKITA_OWNER_ID') or input('Your personal Telegram user ID (allowed sender): ')).strip())
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
        if input('Bind salon archive tabs to Telegram groups now? [y/N] ').strip().lower() == 'y':
            dialogs = [d async for d in c.iter_dialogs() if d.id < 0 and (d.is_group or d.is_channel)]
            for i, dialog in enumerate(dialogs, 1): print(f'{i}: {dialog.name}')
            for profile in GROUPS:
                while True:
                    pick = input(f'{profile} — group number (Enter to skip): ').strip()
                    if not pick: break
                    if not pick.isdigit() or not 1 <= int(pick) <= len(dialogs):
                        print('Choose a listed number.'); continue
                    collect = profile == 'lightcone' and input('Collect participant text in the private author reader? [y/N] ').strip().lower() == 'y'
                    replies = input('Allow the agent to reply here using this profile? [y/N] ').strip().lower() == 'y'
                    try: bind(BASE, profile, dialogs[int(pick)-1].id, collect, replies)
                    except ValueError as e: print(e); continue
                    break
        with tempfile.NamedTemporaryFile('w', dir=BASE, delete=False) as out:
            json.dump(dict(api=api, secret=secret, owner=owner, account=me.id, session=c.session.save()), out)
            out.flush(); os.fsync(out.fileno())
        os.replace(out.name, CONFIG)
    finally:
        await c.disconnect()
    print('Telegram connected.')


def owner_dm(e, owner):
    return bool(e.is_private and not e.out and e.sender_id == owner and e.chat_id == owner and ((e.raw_text or '').strip() or attachment_type(getattr(e, 'message', None))))


def conversation_profile(name):
    data = Path(os.environ.get('PI_WEB_TELEGRAM_DATA') or APP / 'data')
    try:
        saved = json.loads((data / 'conversation-profiles.json').read_text())
    except FileNotFoundError:
        return {}
    if saved.get('version') != 1 or not isinstance(saved.get('profiles'), dict):
        raise ValueError('Invalid conversation profiles')
    profile = saved['profiles'].get(name, {})
    if not isinstance(profile, dict): raise ValueError('Invalid conversation profile')
    return profile


def owner_profile():
    return conversation_profile('owner_dm')


def group_policy(tab, peer):
    if read(BASE / 'reply-bindings.json', {}).get(tab) != peer or read(BASE / 'archive-bindings.json', {}).get(tab) != peer:
        return {}, 'off', ()
    data = Path(os.environ.get('PI_WEB_TELEGRAM_DATA') or APP / 'data')
    if tab == 'lightcone' and read(APP/'data/browser-settings.json', {}).get('lightconeReplies') is False:
        return {}, 'off', ()
    profile = conversation_profile(tab)
    if not profile and tab in ('lake', 'arri'): return {}, 'off', ()
    names = read(data/'addressing.json', {}).get('names', [])
    return profile, profile.get('replyMode', 'mention_reply'), names


def selected_model(profile):
    if profile.get('model'): return profile['model']
    data = Path(os.environ.get('PI_WEB_TELEGRAM_DATA') or APP / 'data')
    for file in (data / 'model.txt', APP / 'data/browser-model.txt'):
        if file.is_file() and file.read_text().strip(): return file.read_text().strip()
    return os.environ.get('PI_WEB_MODEL', '')  # Otherwise let the enrolled Pi choose.


async def answer(text, profile=None, group=None, addressing='', *, inspect_owner=False, frames=()):
    if profile is None: profile = owner_profile()
    pi = os.environ.get('PI_WEB_PI_BIN') or shutil.which('pi')
    if not pi:
        raise RuntimeError('Pi CLI not found')
    cwd = BASE / 'conversation'
    if group is not None:
        if type(group) is not int or group >= 0: raise ValueError('Invalid group peer')
        cwd = BASE / f'conversation-group-{group}'
    cwd.mkdir(mode=0o700, exist_ok=True)
    args = [pi, '--print', '--no-context-files', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-tools']
    env = os.environ.copy(); env.pop('NIKITA_OWNER_INSPECTION_DIR', None)
    if (inspect_owner and group is None and text.strip().lower() == 'ok' and not profile.get('toolsOn', True)
            and not profile.get('memory', True) and not profile.get('tailOn', True) and (BASE/'inspection/armed').is_file()):
        args.extend(['--extension', str(APP/'telegram/request-inspection.ts')])
        env['NIKITA_OWNER_INSPECTION_DIR'] = str(BASE/'inspection')
    if profile.get('memory', True) and profile.get('memoryLimit', 100) > 0:
        since = int(profile.get('memoryResetAt') or 0)
        sessions = cwd / ('after-' + str(since)) if since > 0 else cwd
        sessions.mkdir(mode=0o700, exist_ok=True)
        args.extend(['--session-dir', str(sessions), '--continue'])
    else:
        args.append('--no-session')
    model = selected_model(profile)
    if model: args.extend(['--model', model])
    if profile.get('thinking'): args.extend(['--thinking', profile['thinking']])
    parts = []
    if profile.get('baseOn', True) and profile.get('basePrompt'): parts.append(profile['basePrompt'])
    if profile.get('systemPrompt') and profile.get('character'): parts.append('Shared character instructions:\n' + profile['character'])
    if profile.get('customOn', True) and profile.get('customPrompt'):
        parts.append('Manner instructions. These are required in every reply and take precedence over any default tone:\n' + profile['customPrompt'])
    policy = APP / 'services/tool-policy.txt'
    if group is None and profile.get('toolsOn', True) and policy.is_file(): parts.append(policy.read_text())
    if addressing: parts.append(addressing)
    if profile.get('tailOn') and profile.get('tail', '').strip():
        text += '\n\n[Приписка владельца, не сообщение и не просьба ответить на неё: ' + profile['tail'].strip() + ']'
    native = profile.get('piOn') is True
    # Keep literal prompts out of argv and never treat user text as a file path.
    with tempfile.NamedTemporaryFile('w', dir=cwd) as prompt:
        if parts or not native:
            prompt.write('\n\n'.join(parts) or ' '); prompt.flush()
            args.extend(['--append-system-prompt' if native else '--system-prompt', prompt.name])
        args.extend('@'+str(path) for path in frames)
        p = await asyncio.create_subprocess_exec(*args, cwd=cwd, env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            data, _ = await asyncio.wait_for(p.communicate(text.encode()), 360)
        finally:
            if p.returncode is None:
                p.kill(); await p.wait()
    if p.returncode or not data.strip():
        raise RuntimeError('Pi returned no reply')
    return data.decode(errors='replace').strip()


async def tool_turn(e):
    profile = owner_profile()  # Pin one settings snapshot for inference and dispatch.
    tools = profile.get('toolsOn', True)
    prepared_edit = None
    direct = re.fullmatch(r'/(image|science)\s+([\s\S]+)', e.raw_text or '')
    if direct and not tools: return 'Tools are off for this conversation.', None
    if direct:
        action = {'nikita_tool':'image','prompt':direct[2]} if direct[1]=='image' else {'nikita_tool':'python','code':direct[2]}
        text = ''
    else:
        # Only serve()'s enrolled-owner DM path reaches here. Replies/forwards/media are not inspection tests.
        test = ((e.raw_text or '').strip().lower() == 'ok' and not e.message.reply_to_msg_id
                and not e.message.fwd_from and not e.message.media)
        quoted = None
        if getattr(e.message, 'reply_to_msg_id', None):
            candidate = await e.get_reply_message()
            if candidate and candidate.chat_id == e.chat_id: quoted = candidate
        if attachment_type(e.message) or attachment_type(quoted):
            async with sampled_inputs(e.message, quoted) as (frames, note):
                text = await answer((e.raw_text or '')+'\n\n'+note, profile, frames=frames)
                if tools and text.lstrip().startswith('{'):
                    photo=next((p for p in frames if p.name.startswith('photo-')),None)
                    if photo: prepared_edit=base64.b64encode(photo.read_bytes()).decode()
        else:
            text = await answer(e.raw_text, profile, inspect_owner=test)
        if not tools: return text, None
        try: action = json.loads(text)
        except ValueError: return text, None
    if not isinstance(action,dict) or action.get('nikita_tool') not in ('image','python'): return text, None
    image = action['nikita_tool']=='image'; field = 'prompt' if image else 'code'
    if not isinstance(action.get(field), str): raise RuntimeError('Invalid tool request')
    request = {'action':action['nikita_tool'],field:action[field]}
    if image and prepared_edit:
        request['image']=prepared_edit
    elif image:
        source = e.message
        if attachment_type(source) not in PHOTOS and source.reply_to_msg_id:
            candidate = await e.get_reply_message()
            if candidate and candidate.chat_id == e.chat_id: source = candidate
        if attachment_type(source) in PHOTOS:
            async with sampled_inputs(source) as (frames,note):
                if not frames: raise RuntimeError(note)
                request['image']=base64.b64encode(frames[0].read_bytes()).decode()
    # Commit before dispatch: reconnects cannot silently purchase the same generation twice.
    db=sqlite3.connect(BASE/'tool-turns.sqlite');
    try:
        with db:
            db.execute('create table if not exists attempts(chat integer, id integer, primary key(chat,id))')
            if not db.execute('insert or ignore into attempts values(?,?)',(e.chat_id,e.id)).rowcount: return '',None
    finally: db.close()
    payload=json.dumps({'request':request,'model':selected_model(profile)}).encode()
    proc=await asyncio.create_subprocess_exec('node','--import','tsx','services/tools.mjs',cwd=APP,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    try: data,_=await asyncio.wait_for(proc.communicate(payload),335)
    finally:
        if proc.returncode is None: proc.kill(); await proc.wait()
    if proc.returncode: raise RuntimeError('Instance tool failed')
    result=json.loads(data)['result']
    if image:
        photo=io.BytesIO(base64.b64decode(result['data'],validate=True)); photo.name='image.'+{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[result['mimeType']]
        return '',photo
    return '\n'.join(filter(None,['Scientific result:' if result.get('ok') else 'Calculation did not complete:',result['stdout']['text'],result['stderr']['text']])),None


async def serve():
    if not CONFIG.is_file():
        raise SystemExit('Telegram not connected; run connect first.')
    conf = json.loads(CONFIG.read_text()); owner = conf['owner']
    c = TelegramClient(StringSession(conf['session']), conf['api'], conf['secret'], sequential_updates=True)
    archive = SalonArchive(BASE, owner)
    async def send_group(msg, text):
        for body, entities in message_parts(text, formatted=True):
            sent = await msg.reply(body, formatting_entities=entities, link_preview=False)
            archive.notify(msg.chat_id, sent.id)
            await verify_blocks(c, msg.chat_id, sent, entities)
    groups = GroupService(BASE, group_policy, answer, send_group)
    tasks = []
    @c.on(events.NewMessage(incoming=True))
    async def archive_incoming(e):
        groups.notify(e.chat_id)
        # Author collection is independent of reply permission.
        if e.chat_id == archive.reader_peer: archive.notify(e.chat_id, e.id)

    @c.on(events.NewMessage(outgoing=True))
    async def archive_outgoing(e):
        archive.notify(e.chat_id, e.id)

    @c.on(events.NewMessage(incoming=True, from_users=[owner]))
    async def incoming(e):
        if not owner_dm(e, owner):
            return
        try:
            async with c.action(owner, 'typing'):
                text, photo = await tool_turn(e)
                if photo is not None:
                    sent = await e.reply(file=photo,force_document=False); archive.notify(owner,sent.id); return
        except (RuntimeError, OSError, ValueError, KeyError, asyncio.TimeoutError):
            await e.reply('Could not complete the request. Check the selected provider, its image access, or the science service.'); return
        for body, entities in message_parts(text, formatted=True):
            sent = await e.reply(body, formatting_entities=entities, link_preview=False)
            archive.notify(owner, sent.id)
            await verify_blocks(c, owner, sent, entities)
    try:
        await c.connect()
        me = await c.get_me()
        if not me or me.id != conf['account']:
            raise SystemExit('Telegram account mismatch or expired authorization.')
        tasks.extend((asyncio.create_task(archive.run(c)), asyncio.create_task(groups.run(c, me))))
        await c.run_until_disconnected()
    finally:
        for task in tasks: task.cancel()
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)
        await c.disconnect()


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest='action', required=True)
    for name in ('connect','run','status'): sub.add_parser(name)
    route = sub.add_parser('bind'); route.add_argument('profile',choices=GROUPS); route.add_argument('peer',type=int)
    route.add_argument('--authors',action='store_true',help='Also archive participant text in the authenticated LightCone reader')
    permission = route.add_mutually_exclusive_group()
    permission.add_argument('--replies', dest='replies', action='store_true', help='Allow group text replies')
    permission.add_argument('--no-replies', dest='replies', action='store_false', help='Stop group replies, retaining the archive')
    route.set_defaults(replies=None)
    args = parser.parse_args(); action = args.action
    if action == 'bind':
        try: bind(BASE, args.profile, args.peer, args.authors, args.replies)
        except ValueError as e: parser.error(str(e))
        print('Archive tab bound:', args.profile)
    elif action == 'status':
        print('Connected' if CONFIG.is_file() else 'Installed; not connected')
    else:
        with exclusive():
            asyncio.run(enroll() if action == 'connect' else serve())
