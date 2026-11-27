#!/usr/bin/env python3
"""Отправить формулу в чат настоящей телеграм-статьёй (родные LaTeX-формулы).

    ./venv/bin/python send_formula.py --tex '\\pi=4\\left(1-\\frac13+\\frac15-\\cdots\\right)'
    ./venv/bin/python send_formula.py --text 'текст с формулой $$E=mc^2$$ и ещё $\\alpha$'
    ./venv/bin/python send_formula.py --file note.md --caption 'Ряд Лейбница'
    ./venv/bin/python send_formula.py --reply 70374 --tex '...'
    ./venv/bin/python send_formula.py --chat curvelab --tex '...'
    ./venv/bin/python send_formula.py --image --tex '...'   # запасной путь: PNG

Разметка --text/--file: `# заголовок`, `$$...$$` — формула отдельным блоком,
`$...$` — формула внутри строки, пустая строка — новый абзац. Картинки не нужны:
телеграм сам рисует формулы.

Печатает [отправлено] — значит всё ушло, отвечать в чат больше не надо.
"""
import argparse
import asyncio
import os
import re
import subprocess
import sys
import tempfile

from typing_client import TelegramClient
from telethon import functions, types
from telethon.sessions import StringSession

# отдельная сессия-клон (строкой, без sqlite-файла): демон держит account.session,
# второй процесс на том же файле ловил бы database is locked
from config import API_ID, API_HASH

SESSION = "/opt/tg-agent/send.string"
CHAT_PHYSICS = -@@DEBRI_PEER@@
CHAT_CURVELAB = -@@LEGACY_LAB_PEER@@
HERE = os.path.dirname(os.path.abspath(__file__))
NODE = "/root/.local/share/pi-node/current/bin/node"
RENDER = os.path.join(HERE, "mathrender", "render.js")


def build_markdown(a) -> str:
    parts = []
    if a.caption:
        parts.append(a.caption.strip())
    for t in a.tex:
        parts.append("$$\n" + t.strip() + "\n$$")
    body = a.text or ""
    if a.file:
        with open(a.file, encoding="utf-8") as fh:
            body = fh.read()
    if body.strip():
        parts.append(body.strip())
    return "\n\n".join(parts)


def render_png(tex: str, width: int) -> str:
    svg = tempfile.mktemp(suffix=".svg")
    png = tempfile.mktemp(suffix=".png")
    proc = subprocess.run([NODE, RENDER, svg, tex, "1"], timeout=60,
                          cwd=os.path.join(HERE, "mathrender"),
                          capture_output=True, text=True)
    if proc.returncode != 0:
        lines = [l.strip() for l in (proc.stderr or "").splitlines() if l.strip()]
        msg = next((m.group(1) for l in lines if (m := re.search(r"message: '(.*)'", l))), "")
        if not msg:
            msg = next((l for l in lines if l.startswith(("Error", "TexError"))), "bad tex")
        raise RuntimeError(msg[:300])
    subprocess.run(["rsvg-convert", "-w", str(width), "-b", "white", svg, "-o", png],
                   check=True, timeout=60)
    os.unlink(svg)
    return png


async def resolve_peer(client, chat):
    """id канала приходит без -100: пробуем как есть, потом добавляем префикс."""
    if chat == "me":
        return await client.get_input_entity("me")
    try:
        return await client.get_input_entity(chat)
    except Exception:
        if isinstance(chat, int) and chat > 0:
            return await client.get_input_entity(-(10 ** 12 + chat))
        raise


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tex", action="append", default=[], help="голая формула (можно несколько)")
    ap.add_argument("--text", default="", help="статья в разметке: $..$, $$..$$, # заголовок")
    ap.add_argument("--file", help="то же, но из файла")
    ap.add_argument("--caption", default="", help="абзац перед формулами")
    ap.add_argument("--chat", default="physics", help="physics | curvelab | me | <id>")
    ap.add_argument("--reply", type=int)
    ap.add_argument("--image", action="store_true", help="прислать картинкой, а не статьёй")
    ap.add_argument("--width", type=int, default=1600, help="ширина картинки в --image")
    ap.add_argument("--dry", help="не отправлять, напечатать/сохранить для проверки")
    a = ap.parse_args()

    if os.environ.get("SEND_FORMULA_DRY"):   # страховка для тестов
        a.dry = a.dry or os.environ["SEND_FORMULA_DRY"]

    md = build_markdown(a)
    if not md:
        print("нечего отправлять")
        return

    if a.chat in ("physics", "физ"):
        chat = CHAT_PHYSICS
    elif a.chat in ("curvelab", "лаб"):
        chat = CHAT_CURVELAB
    elif a.chat in ("me", "себе"):
        chat = "me"
    else:
        chat = int(a.chat)
    if os.environ.get("SEND_FORMULA_TO"):    # тест: слать в «Избранное», а не в чат
        chat = os.environ["SEND_FORMULA_TO"]

    if a.dry:
        print(md)
        return

    client = TelegramClient(StringSession(open(SESSION).read().strip()), API_ID, API_HASH)
    await client.connect()
    try:
        if a.image:
            png = render_png(a.tex[0] if a.tex else md, a.width)
            await client.send_file(chat, png, caption=a.caption[:1024], reply_to=a.reply)
            os.unlink(png)
        else:
            await client(functions.messages.SendMessageRequest(
                peer=await resolve_peer(client, chat),
                message="",
                no_webpage=True,
                reply_to=types.InputReplyToMessage(a.reply) if a.reply else None,
                rich_message=types.InputRichMessageMarkdown(markdown=md),
            ))
        print("[отправлено]")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
