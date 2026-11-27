"""Group video-note transport. Never resend after an uncertain Telegram write."""
import asyncio
import io
import logging
import re
import struct
import tempfile
from pathlib import Path
from telethon import types
from spoken_reply import GOOGLE_SOCKET, google_wave
from circle_media import speech_pcm

SOCKET = GOOGLE_SOCKET.with_name(GOOGLE_SOCKET.name.replace('gacrux', 'circle'))
SLOT = asyncio.Lock()
HINT = '\n\n[Delivery: answer aloud in 15–30 seconds, a few natural sentences without markup. Do not post separately.]'


def provider():
    selector = Path('/etc/pi-web-speech')/GOOGLE_SOCKET.stem.removeprefix('pi-web-gacrux-')/'circle-provider'
    try: value = selector.read_text().strip()
    except FileNotFoundError: return 'anam'
    if value not in ('anam','heygen'): raise ValueError('Unknown circle provider')
    return value


async def prepare(line, selected='anam', peer=None, mid=None):
    with tempfile.TemporaryDirectory(prefix='nikita-circle-') as folder:
        wav = Path(folder)/'speech.wav'
        await asyncio.wait_for(google_wave(line, wav), 58)
        speech_pcm(wav)
        socket = SOCKET if selected=='anam' else SOCKET.with_name(SOCKET.name.replace('circle','heygen'))
        reader, writer = await asyncio.open_unix_connection(str(socket))
        try:
            if selected=='heygen': writer.write(struct.pack('!qQ',peer,mid))
            writer.write(wav.read_bytes()); await writer.drain(); writer.write_eof()
            size, ms = struct.unpack('!II', await reader.readexactly(8))
            if not 0 < size <= 40*1024**2 or not 0 < ms <= 60000:
                raise ValueError('Invalid render receipt')
            data = await reader.readexactly(size)
        finally:
            writer.close(); await writer.wait_closed()
        stream = io.BytesIO(data); stream.name = 'circle.mp4'
        return stream, types.DocumentAttributeVideo(duration=ms/1000, w=640, h=640, round_message=True, supports_streaming=True)


async def send_circle(client, peer, mid, text):
    line = ' '.join(text.replace('**','').split())
    if SLOT.locked() or not line or len(line)>1500 or re.search(r'https?://|```|(?:sk-|AQ\.|AIza)[A-Za-z0-9_-]{12,}|-----BEGIN .*KEY-----', line, re.I):
        return None
    async with SLOT:
        try:
            async with client.action(peer, 'record-round'):
                selected=provider()
                stream, attr = await asyncio.wait_for(prepare(line) if selected=='anam' else prepare(line,selected,peer,mid), 160 if selected=='anam' else 990)
        except Exception as exc:
            logging.getLogger(__name__).warning('Circle preparation failed: %s', type(exc).__name__)
            return None
    try:
        sent = await asyncio.wait_for(client.send_file(peer,stream,reply_to=mid,video_note=True,attributes=[attr],mime_type='video/mp4'), 90)
        if sent.video_note and sent.reply_to_msg_id == mid: return sent
    except Exception:
        pass
    async def reconcile():
        async for msg in client.iter_messages(peer, limit=40, min_id=mid):
            if msg.out and msg.reply_to_msg_id == mid and msg.video_note: return msg
    existing = await asyncio.wait_for(reconcile(), 15)
    if existing: return existing
    raise RuntimeError('Unconfirmed circle delivery; do not retry')
