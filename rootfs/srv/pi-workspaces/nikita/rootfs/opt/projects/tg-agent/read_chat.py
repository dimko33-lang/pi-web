#!/usr/bin/env python3
"""Читает последние сообщения чата «Дебри Физики»."""
import asyncio
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession

from config import API_ID, API_HASH

# демон держит account.session, поэтому читаем через сессию-клон (строкой, без sqlite)
SESSION = "/opt/tg-agent/send.string"

CHAT_ID = -@@DEBRI_PEER@@
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 15


async def main() -> None:
    client = TelegramClient(StringSession(open(SESSION).read().strip()), API_ID, API_HASH)
    await client.connect()
    entity = await client.get_entity(CHAT_ID)
    messages = []
    async for msg in client.iter_messages(entity, limit=LIMIT):
        messages.append(msg)
    for msg in reversed(messages):
        sender = await msg.get_sender()
        who = getattr(sender, "first_name", None) or "?"
        text = (msg.message or "").replace("\n", " ").strip()
        if not text:
            continue
        print(f"[{msg.date:%d.%m %H:%M}] {who} (id={msg.id}): {text[:400]}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
