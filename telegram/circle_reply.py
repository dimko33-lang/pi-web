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


async def prepare(line):
    with tempfile.TemporaryDirectory(prefix='nikita-circle-') as folder:
        wav = Path(folder)/'speech.wav'
        await asyncio.wait_for(google_wave(line, wav), 58)
        speech_pcm(wav)
        reader, writer = await asyncio.open_unix_connection(str(SOCKET))
        try:
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
            stream, attr = await asyncio.wait_for(prepare(line), 160)
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
