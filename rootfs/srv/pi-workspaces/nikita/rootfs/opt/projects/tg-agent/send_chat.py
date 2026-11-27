#!/usr/bin/env python3
"""Отправить сообщение в чат «Дебри Физики» от аккаунта nikita.

    ./venv/bin/python send_chat.py "текст"
    ./venv/bin/python send_chat.py --reply 70305 "текст"
"""
import asyncio
import sys

from typing_client import TelegramClient

from config import API_ID, API_HASH, SESSION

CHAT_ID = -@@DEBRI_PEER@@


async def main() -> None:
    args = sys.argv[1:]
    reply_to = None
    if args and args[0] == "--reply":
        if len(args) < 3:
            print("нужно: send_chat.py --reply <id> <текст>")
            return
        reply_to = int(args[1])
        text = " ".join(args[2:])
    else:
        text = " ".join(args)

    if not text.strip():
        print("пустой текст - не отправляю")
        return

    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    try:
        msg = await client.send_message(CHAT_ID, text, reply_to=reply_to)
        print(f"отправлено id={msg.id}")
    finally:
        await client.disconnect()


asyncio.run(main())
