"""Refresh only Nikita's recent Pi Web messages for the owner-only salon."""
import asyncio, json, os, tempfile, sys
from pathlib import Path
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import MessageMediaPhoto
from config import API_ID, API_HASH
from circle_transcripts import sql_reader, lookup
receipt = sql_reader(Path.cwd()/'users')

LIGHTCONE = sys.argv[1:] == ['lightcone']
CHAT, AUTHOR = (-@@LC_PEER@@ if LIGHTCONE else -@@PROJECT_PEER@@), @@ACCOUNT_ID@@
OUT = Path('/var/lib/nikita-salon-piwep') / ('lightcone' if LIGHTCONE else '.')

def publish(path, data):
    with tempfile.NamedTemporaryFile(dir=OUT, delete=False) as f:
        f.write(data)
        os.fchmod(f.fileno(), 0o644)
    os.replace(f.name, path)

async def main():
    client = TelegramClient(StringSession(Path('send.string').read_text().strip()), API_ID, API_HASH)
    await client.connect()
    try:
        me = await client.get_me()
        if not me or me.id != AUTHOR: raise RuntimeError('Unexpected Telegram account')
        peer = None
        async for dialog in client.iter_dialogs():
            if dialog.id == CHAT:
                peer = dialog.entity
                break
        if peer is None: raise RuntimeError('Pi Web unavailable')
        rows = []
        async for m in client.iter_messages(peer, from_user=me, limit=300):
            if m.sender_id != AUTHOR or m.chat_id != CHAT: continue
            photo = isinstance(m.media, MessageMediaPhoto)
            if photo:
                path = OUT / f'{m.id}.jpg'
                if not path.exists():
                    data = await client.download_media(m, file=bytes, thumb=-1)
                    if data and data[:3] == b'\xff\xd8\xff': publish(path, data)
                photo = path.exists()
            text=m.raw_text or lookup(m,receipt)
            if photo or (text and not LIGHTCONE): rows.append(dict(author_id=f'user{AUTHOR}',text=text,photo=photo,original=dict(id=m.id,date_unixtime=int(m.date.timestamp()))))
        index = OUT / 'messages.json'
        previous = json.loads(index.read_text()) if index.exists() else {'author': {'id': f'user{AUTHOR}'}, 'messages': []}
        if previous['author']['id'] != f'user{AUTHOR}': raise RuntimeError('Unexpected archive author')
        by_id = {r['original']['id']: r for r in previous['messages']}
        for r in rows: by_id[r['original']['id']] = r
        rows = sorted(by_id.values(), key=lambda r: r['original']['id'], reverse=True)
        publish(index, json.dumps(dict(author=dict(id=f'user{AUTHOR}'), messages=rows),ensure_ascii=False).encode())
        keep = {r['original']['id'] for r in rows if r['photo']}
        print(f'Published {len(rows)} messages and {len(keep)} photo previews')
    finally: await client.disconnect()

asyncio.run(main())
