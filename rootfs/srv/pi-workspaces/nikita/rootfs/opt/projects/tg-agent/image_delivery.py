"""Generate one photo and reply only to the pinned genuine Telegram source message."""
import asyncio
import base64
import hashlib
import io
import json
import logging
import math
from pathlib import Path
import time

log = logging.getLogger('nikita')
SOCKET = '/run/nikita-image/worker.sock'
MAX_PHOTO = 9 * 1024 * 1024
MAX_RESPONSE = 13 * 1024 * 1024


async def request_photo(prompt):
    reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(SOCKET, limit=MAX_RESPONSE), 3)
    try:
        writer.write(json.dumps(prompt if isinstance(prompt, dict) else {'prompt': prompt}, ensure_ascii=False).encode() + b'\n')
        await writer.drain()
        raw = await asyncio.wait_for(reader.readline(), 265)
        if len(raw) > MAX_RESPONSE:
            raise ValueError('Image service returned an oversized response')
        data = json.loads(raw)
        if data.get('ok') is not True:
            raise ValueError(str(data.get('error') or 'Image generation failed')[:500])
        photo = base64.b64decode(data['image_base64'], validate=True)
        if not 0 < len(photo) <= MAX_PHOTO or not photo.startswith(b'\xff\xd8') or data.get('mime_type') != 'image/jpeg':
            raise ValueError('Image service returned an invalid photo')
        if hashlib.sha256(photo).hexdigest() != data.get('sha256'):
            raise ValueError('Image service photo checksum mismatch')
        return photo, {key: data[key] for key in ('width', 'height', 'sha256')}
    finally:
        writer.close()
        await writer.wait_closed()


def records(state):
    state.db.execute('''CREATE TABLE IF NOT EXISTS image_deliveries (
        chat_id INTEGER NOT NULL, source_id INTEGER NOT NULL, prompt_sha256 TEXT NOT NULL,
        status TEXT NOT NULL, sent_id INTEGER, updated REAL NOT NULL,
        PRIMARY KEY(chat_id, source_id))''')
    state.db.commit()


def update(state, chat, source, status, sent_id=None):
    with state.db:
        state.db.execute('UPDATE image_deliveries SET status=?, sent_id=?, updated=? WHERE chat_id=? AND source_id=?',
                         (status, sent_id, time.time(), chat, source))


def image_operation(runtime, ctx, params, operation):
    if operation == 'generate':
        if set(params) != {'prompt'} or not isinstance(params.get('prompt'), str) or not 0 < len(params['prompt'].strip()) <= 4000:
            raise ValueError('Only a description of 1 to 4000 characters is accepted')
        return params['prompt'].strip(), params['prompt'].strip()
    if operation not in ('edit', 'adjust'):
        raise ValueError('Unknown image operation')
    allowed = {'prompt', 'source'} if operation == 'edit' else {'source', 'saturation', 'contrast', 'exposure'}
    if set(params) - allowed:
        raise ValueError('Invalid image operation parameters')
    source = params.get('source', 1)
    sources = ctx.get('image_sources', ())
    if type(source) is not int or not 1 <= source <= len(sources):
        raise ValueError('No such source image in this message or its same-chat Reply. Ask the user to attach a photo or Reply to it.')
    request = {'operation': operation}
    if operation == 'edit':
        prompt = params.get('prompt')
        if not isinstance(prompt, str) or not 0 < len(prompt.strip()) <= 4000:
            raise ValueError('Image edit description must contain 1 to 4000 characters')
        request['prompt'] = prompt.strip()
        description = '[Edited source image ' + str(source) + '] ' + prompt.strip()
    else:
        for field, low, high in (('saturation', 0, 2), ('contrast', .5, 1.5), ('exposure', -2, 2)):
            value = params.get(field, 0 if field == 'exposure' else 1)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError('Invalid adjustment: ' + field)
            request[field] = value
        description = '[Color-adjusted source image ' + str(source) + '] ' + json.dumps({k:v for k,v in request.items() if k != 'operation'})
    # Sources are pinned by the transport, never supplied as model paths/URLs/IDs.
    root = (runtime.workspace(ctx['uid']) / 'uploads').resolve()
    path = Path(sources[source - 1])
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('Source image is outside this conversation uploads')
    with path.open('rb') as stream:
        raw = stream.read(5_000_001)
    if not 0 < len(raw) <= 5_000_000:
        raise ValueError('Source image must be at most 5 MB')
    request['image_base64'] = base64.b64encode(raw).decode()
    return request, description


async def generate_and_reply(runtime, ctx, params, generator=request_photo, operation='generate'):
    if ctx.get('tools_enabled') is False:
        raise ValueError('Tools are disabled for this conversation')
    target = ctx.get('image_target')
    cancelled = ctx.get('image_cancel')
    if not isinstance(target, dict) or cancelled is None or cancelled.is_set():
        raise ValueError('No active Telegram request for photo delivery')
    chat, source = target.get('chat_id'), target.get('reply_to')
    expected_chat = -ctx['uid'] if ctx.get('channel') else ctx['uid']
    if chat != expected_chat or type(source) is not int or source <= 0:
        raise ValueError('Invalid photo reply target')
    if not ctx.get('channel') and not runtime.access.allowed(ctx['uid']):
        raise ValueError('Private conversation access was revoked')
    request, prompt = image_operation(runtime, ctx, params, operation)
    state = runtime.state(ctx['uid'])
    records(state)
    previous = state.db.execute('SELECT status,sent_id FROM image_deliveries WHERE chat_id=? AND source_id=?', (chat, source)).fetchone()
    if previous:
        status, sent_id = previous
        if status == 'sent':
            return {'sent': True, 'already_sent': True, 'chat_id': chat, 'message_id': sent_id}
        raise ValueError('This request already attempted image generation; no automatic repeat. Send a new message to try again.')
    with state.db:
        state.db.execute('INSERT INTO image_deliveries VALUES (?,?,?,?,NULL,?)',
            (chat, source, hashlib.sha256(prompt.encode()).hexdigest(), 'generating', time.time()))
    ctx['image_attempted'] = True
    task = asyncio.create_task(generator(request))
    stopping = asyncio.create_task(cancelled.wait())
    phase = 'generating'
    try:
        done, _ = await asyncio.wait((task, stopping), return_when=asyncio.FIRST_COMPLETED)
        if stopping in done or cancelled.is_set():
            raise asyncio.CancelledError()
        photo, metadata = await task
        if not ctx.get('channel') and not runtime.access.allowed(ctx['uid']):
            raise ValueError('Private conversation access was revoked')
        if cancelled.is_set():
            raise asyncio.CancelledError()
        phase = 'sending'
        update(state, chat, source, phase)
        buffer = io.BytesIO(photo)
        buffer.name = 'generated-image.jpg' if operation == 'generate' else 'edited-image.jpg'
        # No path, destination or reply ID is accepted from the model; never resend on ambiguity.
        sending = asyncio.create_task(runtime.client.send_file(chat, buffer, reply_to=source,
            force_document=False, caption='', parse_mode=None))
        task = sending
        done, _ = await asyncio.wait((sending, stopping), timeout=60, return_when=asyncio.FIRST_COMPLETED)
        if sending not in done:
            if cancelled.is_set():
                raise asyncio.CancelledError()
            raise TimeoutError('Telegram photo delivery timed out')
        sent = await sending
        if type(getattr(sent, 'id', None)) is not int:
            raise ValueError('Telegram did not confirm a photo message')
        update(state, chat, source, 'sent', sent.id)
        result = {'sent': True, 'chat_id': chat, 'message_id': sent.id,
                  'width': metadata['width'], 'height': metadata['height']}
        ctx['image_sent'] = result
        # A factual record, not a new instruction or a fabricated vision description.
        try:
            state.add('assistant', '[Generated image delivered in reply to message ' + str(source) + '. Description: ' + prompt + ']')
        except Exception:
            log.exception('Image delivered but dialogue record failed chat=%s source_id=%s sent_id=%s', chat, source, sent.id)
        log.info('Generated image delivered chat=%s source_id=%s sent_id=%s sha256=%s', chat, source, sent.id, metadata['sha256'])
        return result
    except asyncio.CancelledError:
        update(state, chat, source, 'uncertain' if phase == 'sending' else 'cancelled')
        raise
    except Exception as exc:
        update(state, chat, source, 'uncertain' if phase == 'sending' else 'failed')
        if phase == 'sending':
            log.warning('Image delivery uncertain chat=%s source_id=%s type=%s; not retrying', chat, source, type(exc).__name__)
            raise ValueError('Photo delivery could not be confirmed. It may already be visible; do not resend automatically.') from exc
        raise
    finally:
        for pending in (task, stopping):
            if not pending.done():
                pending.cancel()
        await asyncio.gather(task, stopping, return_exceptions=True)
