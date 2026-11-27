"""Isolated ChatGPT/Codex image client. No shell, Telegram, arbitrary URLs or API keys."""
import asyncio
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import math
import os
from pathlib import Path
import pwd
import socket
import struct
import time
import uuid
import warnings

import aiohttp
from PIL import Image, ImageEnhance, ImageOps

STATE = Path('/var/lib/nikita-image')
AUTH = STATE / 'auth.json'
SOCKET = Path('/run/nikita-image/worker.sock')
IMAGE_URL = 'https://chatgpt.com/backend-api/codex/images/generations'
EDIT_URL = 'https://chatgpt.com/backend-api/codex/images/edits'
INPUT_LIMIT = 5_000_000
REQUEST_LIMIT = 7_000_000
TOKEN_URL = 'https://auth.openai.com/oauth/token'
CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
RAW_LIMIT = 32 * 1024 * 1024
PHOTO_LIMIT = 9 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 20_000_000
log = logging.getLogger('nikita-image')


class ImageError(Exception):
    """Sanitized error suitable for returning over private IPC."""


def input_image(encoded):
    if not isinstance(encoded, str) or len(encoded) > (INPUT_LIMIT + 2) // 3 * 4:
        raise ImageError('Source image exceeds 5 MB')
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not 0 < len(raw) <= INPUT_LIMIT:
            raise ValueError('Invalid source size')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in ('PNG', 'JPEG', 'WEBP') or source.width * source.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError('Unsupported source')
                if getattr(source, 'n_frames', 1) != 1:
                    raise ValueError('Animated source')
                source.load()
                return ImageOps.exif_transpose(source).convert('RGB')
    except Exception as exc:
        raise ImageError('Source must be a readable static JPEG, PNG or WebP, up to 5 MB and 20 million pixels') from exc


def validate_request(data):
    if isinstance(data, dict) and data.get('operation') in ('edit', 'adjust'):
        operation = data['operation']
        allowed = {'operation', 'image_base64', 'prompt'} if operation == 'edit' else {'operation', 'image_base64', 'saturation', 'contrast', 'exposure'}
        if set(data) - allowed or not {'operation', 'image_base64'} <= set(data):
            raise ImageError('Invalid image operation parameters')
        encoded = data['image_base64']
        if not isinstance(encoded, str) or not 0 < len(encoded) <= (INPUT_LIMIT + 2) // 3 * 4:
            raise ImageError('Source image exceeds 5 MB')
        if operation == 'edit':
            validate_request({'prompt': data.get('prompt')})
        else:
            for field, low, high in (('saturation', 0, 2), ('contrast', .5, 1.5), ('exposure', -2, 2)):
                value = data.get(field, 0 if field == 'exposure' else 1)
                if type(value) not in (float, int) or not math.isfinite(value) or not low <= value <= high:
                    raise ImageError('Invalid adjustment: ' + field)
        return data
    if not isinstance(data, dict) or set(data) != {'prompt'}:
        raise ImageError('Only an image description is accepted')
    prompt = data['prompt']
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
        raise ImageError('Image description must contain 1 to 4000 characters')
    return prompt.strip()


def photo_result(data):
    """Decode provider output once and return a bounded, normalized Telegram photo."""
    items = data.get('data') if isinstance(data, dict) else None
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise ImageError('The image provider returned no single image')
    encoded = items[0].get('b64_json')
    if not isinstance(encoded, str) or len(encoded) > RAW_LIMIT:
        raise ImageError('The image provider returned invalid image data')
    try:
        raw = base64.b64decode(encoded, validate=True)
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in ('PNG', 'JPEG', 'WEBP') or source.width * source.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError('Unsupported image')
                source.load()
                image = source.convert('RGB')
        image.thumbnail((4096, 4096))
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=95, optimize=True)
        raw = output.getvalue()
        if len(raw) > PHOTO_LIMIT:
            raise ValueError('Photo too large')
        return {'ok': True, 'mime_type': 'image/jpeg', 'width': image.width, 'height': image.height,
                'image_base64': base64.b64encode(raw).decode('ascii'), 'sha256': hashlib.sha256(raw).hexdigest()}
    except Exception as exc:
        raise ImageError('The image provider returned an unreadable or oversized image') from exc


class Generator:
    def __init__(self, auth_file=AUTH):
        self.auth_file = auth_file
        self.lock = asyncio.Lock()
        self.refresh_task = None

    async def read_json(self, session, url, payload, headers, timeout):
        async with session.post(url, json=payload, headers=headers, allow_redirects=False,
                                timeout=aiohttp.ClientTimeout(total=timeout)) as response:
            if response.status != 200:
                # Provider errors can contain credentials or prompt text; return only categories.
                if response.status in (401, 403):
                    raise ImageError('Image account authorization failed; the owner must reconnect ChatGPT')
                if response.status == 429:
                    raise ImageError('The image account is rate-limited; try a new request later')
                if response.status == 400:
                    raise ImageError('The image provider rejected this request; try a different description')
                raise ImageError('The image provider is unavailable (HTTP ' + str(response.status) + ')')
            chunks = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                chunks.extend(chunk)
                if len(chunks) > RAW_LIMIT:
                    raise ImageError('Image response exceeds the size limit')
            return json.loads(chunks)

    async def credentials(self, session, force_refresh=False):
        saved = json.loads(self.auth_file.read_text())
        if saved.get('auth_mode') != 'chatgpt' or saved.get('OPENAI_API_KEY'):
            raise ImageError('Only the configured ChatGPT subscription login is permitted')
        tokens = saved['tokens']
        provenance = tokens.get('oauth_provenance', {})
        if provenance.get('issuer', 'https://auth.openai.com') != 'https://auth.openai.com' or provenance.get('client_id', CLIENT_ID) != CLIENT_ID:
            raise ImageError('Unexpected ChatGPT authorization provider')
        access = tokens['access_token']
        part = access.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
        if force_refresh or claims.get('exp', 0) < time.time() + 120:
            try:
                renewed = await self.read_json(session, TOKEN_URL,
                    {'client_id': CLIENT_ID, 'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']},
                    {'Content-Type': 'application/json'}, 45)
            except ImageError as exc:
                raise ImageError('ChatGPT login renewal failed; ask the owner to reconnect the image account') from exc
            if not isinstance(renewed.get('access_token'), str) or not renewed['access_token']:
                raise ImageError('ChatGPT token renewal failed; reconnect the account')
            updated_tokens = {**tokens, **{key: renewed[key] for key in ('access_token', 'refresh_token', 'id_token')
                                        if isinstance(renewed.get(key), str) and renewed[key]}}
            saved = {**saved, 'tokens': updated_tokens, 'last_refresh': datetime.now(timezone.utc).isoformat()}
            temporary = self.auth_file.with_name('auth-' + uuid.uuid4().hex + '.tmp')
            try:
                descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, 'w') as output:
                    json.dump(saved, output)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.auth_file)
            finally:
                temporary.unlink(missing_ok=True)
            tokens = updated_tokens
            access = tokens['access_token']
            log.info('ChatGPT credentials renewed')
        return access, tokens.get('account_id')

    async def process_request(self, request):
        image = input_image(request['image_base64'])
        if request['operation'] == 'edit':
            image.thumbnail((4096, 4096))
            output = io.BytesIO()
            image.save(output, format='JPEG', quality=97)
            return await self.generate(request['prompt'], base64.b64encode(output.getvalue()).decode())
        # Deterministic color correction: no provider, no credentials, no geometry edits.
        image = ImageEnhance.Color(image).enhance(request.get('saturation', 1))
        image = ImageEnhance.Contrast(image).enhance(request.get('contrast', 1))
        exposure = request.get('exposure', 0)
        if exposure:
            def channel(value):
                s = value / 255
                linear = s / 12.92 if s <= .04045 else ((s + .055) / 1.055) ** 2.4
                linear = min(1, linear * 2 ** exposure)
                s = linear * 12.92 if linear <= .0031308 else 1.055 * linear ** (1 / 2.4) - .055
                return round(s * 255)
            image = image.point([channel(v) for v in range(256)] * 3)
        output = io.BytesIO()
        image.save(output, format='PNG')
        return photo_result({'data': [{'b64_json': base64.b64encode(output.getvalue()).decode()}]})

    async def generate(self, prompt, image_base64=None):
        try:
            await asyncio.wait_for(self.lock.acquire(), 30)
        except TimeoutError as exc:
            raise ImageError('Image generator is busy; try a new request later') from exc
        try:
            async with aiohttp.ClientSession(trust_env=False) as session:
                # A cancellation must not interrupt refresh after the server rotates its token.
                self.refresh_task = asyncio.create_task(self.credentials(session))
                try:
                    access, account = await asyncio.shield(self.refresh_task)
                except asyncio.CancelledError:
                    await self.refresh_task
                    raise
                finally:
                    self.refresh_task = None
                headers = {'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json',
                           'originator': 'codex_cli_rs', 'User-Agent': 'nikita-image/1.0',
                           'x-codex-image-turn-id': str(uuid.uuid4())}
                if account:
                    headers['ChatGPT-Account-Id'] = account
                payload = {'model': 'gpt-image-2', 'prompt': prompt,
                           'background': 'opaque', 'quality': 'auto', 'size': 'auto'}
                if image_base64 is not None:
                    payload['images'] = [{'image_url': 'data:image/jpeg;base64,' + image_base64}]
                data = await self.read_json(session, EDIT_URL if image_base64 is not None else IMAGE_URL,
                                            payload, headers, 180)
                return photo_result(data)
        finally:
            self.lock.release()


GENERATOR = Generator()


async def handle(reader, writer):
    task = disconnected = None
    started = time.monotonic()
    job = uuid.uuid4().hex
    try:
        peer = writer.get_extra_info('socket').getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        _, uid, _ = struct.unpack('3i', peer)
        if uid not in (0, pwd.getpwnam('pi-nikita').pw_uid):
            raise ImageError('Not authorized')
        line = await asyncio.wait_for(reader.readline(), 5)
        if len(line) > REQUEST_LIMIT:
            raise ImageError('Image request is too large')
        request = validate_request(json.loads(line))
        signature = request if isinstance(request, str) else json.dumps(request, sort_keys=True)
        log.info('Image job started id=%s operation=%s description_sha256=%s', job,
                 request.get('operation') if isinstance(request, dict) else 'generate',
                 hashlib.sha256(signature.encode()).hexdigest())
        task = asyncio.create_task(GENERATOR.process_request(request) if isinstance(request, dict)
                                   else GENERATOR.generate(request))
        disconnected = asyncio.create_task(reader.read(1))
        done, _ = await asyncio.wait((task, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if disconnected in done:
            raise asyncio.CancelledError()
        result = await task
        log.info('Image job completed id=%s width=%s height=%s sha256=%s seconds=%.2f',
                 job, result['width'], result['height'], result['sha256'], time.monotonic() - started)
    except asyncio.CancelledError:
        log.info('Image job cancelled id=%s', job)
        writer.close()
        return
    except ImageError as exc:
        result = {'ok': False, 'error': str(exc)}
        log.warning('Image job failed id=%s reason=%s', job, str(exc))
    except Exception as exc:
        result = {'ok': False, 'error': 'Image service failed; no photo was delivered'}
        log.warning('Image job failed id=%s type=%s', job, type(exc).__name__)
    finally:
        for pending in (task, disconnected):
            if pending and not pending.done():
                pending.cancel()
        await asyncio.gather(*(p for p in (task, disconnected) if p), return_exceptions=True)
        if task and task.cancelled():
            writer.close()
    try:
        writer.write(json.dumps(result).encode() + b'\n')
        await writer.drain()
    except (ConnectionError, BrokenPipeError):
        pass
    finally:
        writer.close()
        await writer.wait_closed()


async def main():
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, str(SOCKET), limit=REQUEST_LIMIT + 1)
    SOCKET.chmod(0o660)
    log.info('Image worker ready')
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    asyncio.run(main())
