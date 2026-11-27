#!/usr/bin/env python3
"""Арт-картинка 1:1 (квадратное «окошечко») в телеграм.

    ./venv/bin/python send_art.py --frame void --tex '\\oint E\\cdot dA = \\frac{q}{\\varepsilon_0}' --caption 'поток'
    ./venv/bin/python send_art.py --frame neon --svg-file art.svg --caption 'что-нибудь'
    ./venv/bin/python send_art.py --frame paper --reply 70374 --svg '<svg ...>'
    ./venv/bin/python send_art.py --frame blueprint --tex '...' --dry   # только сохранить, не слать

Кадры: void (чёрный с бликом), neon (фиолет), paper (бумага), blueprint (сетка).
Любой рисунок из --svg/--svg-file вписывается в кадр по центру, пропорции сохраняются.
Печатает [отправлено] и путь к png.
"""
import argparse
import asyncio
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

from typing_client import TelegramClient
from telethon.sessions import StringSession

from config import API_ID, API_HASH

SESSION = "/opt/tg-agent/send.string"
CHAT_PHYSICS = -@@DEBRI_PEER@@
CHAT_CURVELAB = -@@LEGACY_LAB_PEER@@
HERE = os.path.dirname(os.path.abspath(__file__))
NODE = "/root/.local/share/pi-node/current/bin/node"
RENDER = os.path.join(HERE, "mathrender", "render.js")

S = 1080        # сторона квадрата
M = 96          # поле


def preset(name: str, s: int) -> str:
    """Фон кадра. Возвращает svg-фрагмент под контент."""
    if name == "neon":
        return f'''
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="#2a1250"/>
      <stop offset="55%" stop-color="#120a24"/>
      <stop offset="100%" stop-color="#05030a"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#c04bff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#c04bff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{s}" height="{s}" fill="url(#bg)"/>
  <circle cx="{s/2}" cy="{s*0.44}" r="{s*0.46}" fill="url(#glow)"/>
  <circle cx="{s/2}" cy="{s/2}" r="{s/2-M*1.2}" fill="none" stroke="#c04bff" stroke-opacity="0.25"/>'''
    if name == "paper":
        return f'''
  <defs>
    <radialGradient id="bg" cx="45%" cy="35%" r="85%">
      <stop offset="0%" stop-color="#fbf7ee"/>
      <stop offset="100%" stop-color="#e6dcc8"/>
    </radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
      <feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="{s}" height="{s}" fill="url(#bg)"/>
  <rect width="{s}" height="{s}" filter="url(#grain)" opacity="0.10"/>
  <rect x="{M*0.7}" y="{M*0.7}" width="{s-M*1.4}" height="{s-M*1.4}" fill="none" stroke="#8a7a5e" stroke-opacity="0.5"/>'''
    if name == "blueprint":
        step = s // 18
        grid = "".join(
            f'<line x1="{x}" y1="0" x2="{x}" y2="{s}" stroke="#4d8fc4" stroke-opacity="0.30"/>'
            for x in range(0, s + 1, step))
        grid += "".join(
            f'<line x1="0" y1="{y}" x2="{s}" y2="{y}" stroke="#4d8fc4" stroke-opacity="0.30"/>'
            for y in range(0, s + 1, step))
        return f'''
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d2b45"/>
      <stop offset="100%" stop-color="#071626"/>
    </linearGradient>
  </defs>
  <rect width="{s}" height="{s}" fill="url(#bg)"/>
  {grid}
  <rect x="{M*0.7}" y="{M*0.7}" width="{s-M*1.4}" height="{s-M*1.4}" fill="none" stroke="#9fd0f0" stroke-opacity="0.6"/>'''
    # void
    return f'''
  <defs>
    <radialGradient id="bg" cx="50%" cy="46%" r="72%">
      <stop offset="0%" stop-color="#1c1c22"/>
      <stop offset="70%" stop-color="#0b0b0e"/>
      <stop offset="100%" stop-color="#050506"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{s}" height="{s}" fill="url(#bg)"/>
  <ellipse cx="{s/2}" cy="{s*0.48}" rx="{s*0.44}" ry="{s*0.34}" fill="url(#glow)"/>
  <rect x="{M*0.7}" y="{M*0.7}" width="{s-M*1.4}" height="{s-M*1.4}" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>'''


INK = {"paper": "#1a1a1a", "void": "#f2f2f2", "neon": "#f6e9ff", "blueprint": "#e8f6ff"}


def svg_size(path: str) -> tuple:
    root = ET.parse(path).getroot()
    vb = root.get("viewBox")
    if vb:
        parts = [float(p) for p in re.split(r"[,\s]+", vb.strip())]
        if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
            return parts[2], parts[3]
    def num(v):
        try:
            return float(re.sub(r"[^0-9.]", "", v or "") or 0)
        except ValueError:
            return 0.0
    return num(root.get("width")), num(root.get("height"))


def render_tex(tex: str) -> str:
    out = tempfile.mktemp(suffix=".svg")
    proc = subprocess.run([NODE, RENDER, out, tex, "1"], timeout=60,
                          cwd=os.path.join(HERE, "mathrender"),
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "bad tex")[:300])
    return out


def build(path: str, frame: str, s: int) -> str:
    body = preset(frame, s)
    data = open(path, encoding="utf-8").read()
    # TeX красит в currentColor, а внешняя картинка не наследует цвет кадра
    data = data.replace("currentColor", INK.get(frame, "#f2f2f2"))
    # свой viewBox не даёт вставить <svg> внутрь <svg>, поэтому кладём как картинку
    tmp = tempfile.mktemp(suffix=".svg")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(data)
    box = s - M * 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="{s}" height="{s}" viewBox="0 0 {s} {s}">
{body}
  <image xlink:href="{tmp}" x="{M}" y="{M}" width="{box}" height="{box}"
         preserveAspectRatio="xMidYMid meet"/>
</svg>'''


async def resolve_peer(client, chat):
    try:
        return await client.get_input_entity(chat)
    except Exception:
        if isinstance(chat, int) and chat > 0:
            return await client.get_input_entity(-(10 ** 12 + chat))
        raise


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--svg", help="svg-разметка строкой")
    ap.add_argument("--svg-file", help="готовый svg-файл")
    ap.add_argument("--tex", help="формула (соберётся в svg)")
    ap.add_argument("--frame", default="void", help="void | neon | paper | blueprint")
    ap.add_argument("--size", type=int, default=S, help="сторона квадрата, px")
    ap.add_argument("--caption", default="")
    ap.add_argument("--chat", default="physics", help="physics | curvelab | me | <id>")
    ap.add_argument("--reply", type=int)
    ap.add_argument("--out", help="куда сохранить png (по умолчанию /tmp)")
    ap.add_argument("--dry", action="store_true", help="не отправлять, только отрендерить")
    a = ap.parse_args()

    if a.tex:
        src = render_tex(a.tex)
    elif a.svg_file:
        src = a.svg_file
    elif a.svg:
        src = tempfile.mktemp(suffix=".svg")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(a.svg)
    else:
        print("нужен --tex, --svg или --svg-file")
        sys.exit(2)

    wrapper = tempfile.mktemp(suffix=".svg")
    with open(wrapper, "w", encoding="utf-8") as fh:
        fh.write(build(src, a.frame, a.size))
    png = a.out or tempfile.mktemp(suffix=".png")
    subprocess.run(["rsvg-convert", "-w", str(a.size), wrapper, "-o", png],
                   check=True, timeout=60)
    print(f"[png] {png}")

    if a.dry:
        return

    if a.chat in ("physics", "физ"):
        chat = CHAT_PHYSICS
    elif a.chat in ("curvelab", "лаб"):
        chat = CHAT_CURVELAB
    elif a.chat in ("me", "себе"):
        chat = "me"
    else:
        chat = int(a.chat)
    if os.environ.get("SEND_FORMULA_TO"):
        chat = os.environ["SEND_FORMULA_TO"]

    client = TelegramClient(StringSession(open(SESSION).read().strip()), API_ID, API_HASH)
    await client.connect()
    try:
        await client.send_file(chat, png, caption=a.caption[:1024], reply_to=a.reply,
                               force_document=False)
        print("[отправлено]")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
