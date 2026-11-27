"""Publish long LightCone answers as Telegraph articles (Telegram's native reader).

Telegraph renders no LaTeX, so formulas are rasterised as SVG by an external
renderer, uploaded to Telegraph and embedded as images.
"""
import asyncio
import html
import json
import logging
import os
import re
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

log = logging.getLogger('nikita')
API = 'https://api.telegra.ph'
STATE = Path(os.environ.get('NIKITA_TELEGRAPH_STATE', '/srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent/telegraph-token.json'))
AUTHOR = 'Никита Сократ'
TIMEOUT = 20


def _get(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def _api(method, **params):
    body = urllib.parse.urlencode({k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v)
                                   for k, v in params.items()}).encode()
    payload = json.loads(_get(f'{API}/{method}', data=body))
    if not payload.get('ok'):
        raise ValueError(f"Telegraph {method}: {payload.get('error')}")
    return payload['result']


def token():
    try:
        saved = json.loads(STATE.read_text())
        if saved.get('access_token'):
            return saved['access_token']
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    result = _api('createAccount', short_name='nikita-' + uuid.uuid4().hex[:10],
                  author_name=AUTHOR)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({'access_token': result['access_token'], 'author_name': AUTHOR}))
    os.chmod(STATE, 0o600)
    return result['access_token']


def _math_src(tex):
    """External SVG-free PNG rendering: Telegraph keeps absolute img URLs."""
    encoded = urllib.parse.quote(tex.strip(), safe='')
    return f'https://latex.codecogs.com/png.image?{encoded}'


MATH = re.compile(r'\$\$(?P<display>.+?)\$\$|\$(?P<inline>[^$\n]+?)\$', re.S)
INLINE = re.compile(r'\*\*(?P<bold>[^*\n]+)\*\*|`(?P<code>[^`\n]+)`|\[(?P<label>[^\]\n]+)\]\((?P<href>[^)\s]+)\)')


def _esc(text):
    return text


def _inline_nodes(text, uploads):
    nodes, pos = [], 0
    for match in INLINE.finditer(text):
        if match.start() > pos:
            nodes.append(text[pos:match.start()])
        if match.group('bold') is not None:
            nodes.append({'tag': 'strong', 'children': [match.group('bold')]})
        elif match.group('code') is not None:
            nodes.append({'tag': 'code', 'children': [match.group('code')]})
        else:
            href = match.group('href')
            if href.startswith(('http://', 'https://')):
                nodes.append({'tag': 'a', 'attrs': {'href': href}, 'children': [match.group('label')]})
            else:
                nodes.append(match.group('label'))
        pos = match.end()
    if pos < len(text):
        nodes.append(text[pos:])
    return [n for n in nodes if n != '']


def _math_node(tex, display, uploads):
    try:
        src = uploads(tex)
        node = {'tag': 'img', 'attrs': {'src': src}}
        return node if display else node
    except Exception:
        log.warning('TeX upload failed; keeping source text')
        return {'tag': 'code', 'children': [(f'$${tex}$$' if display else f'${tex}$')]}


def markdown_to_nodes(markdown, uploads):
    """Convert the model's Markdown into Telegraph nodes, one math image per formula."""
    nodes, paragraph, code, list_items = [], [], None, []
    def flush_paragraph():
        nonlocal paragraph
        if not paragraph:
            return
        text = ' '.join(line.strip() for line in paragraph).strip()
        paragraph = []
        if not text:
            return
        children, pos = [], 0
        for match in MATH.finditer(text):
            if match.start() > pos:
                children.extend(_inline_nodes(text[pos:match.start()], uploads))
            display = match.group('display')
            children.append(_math_node(display if display is not None else match.group('inline'),
                                       display is not None, uploads))
            pos = match.end()
        if pos < len(text):
            children.extend(_inline_nodes(text[pos:], uploads))
        nodes.append({'tag': 'p', 'children': children})
    def flush_list():
        nonlocal list_items
        if list_items:
            nodes.append({'tag': 'ul', 'children': [{'tag': 'li', 'children': _inline_nodes(i, uploads)} for i in list_items]})
            list_items = []
    for raw in markdown.replace('\r\n', '\n').split('\n'):
        line = raw.rstrip()
        if code is not None:
            if line.startswith('```'):
                nodes.append({'tag': 'pre', 'children': [''.join(code)]})
                code = None
            else:
                code.append(raw + '\n')
            continue
        if line.startswith('```'):
            flush_paragraph(); flush_list(); code = []
            continue
        if not line.strip():
            flush_paragraph(); flush_list()
            continue
        heading = re.match(r'^(#{1,3})\s+(.*)$', line)
        if heading:
            flush_paragraph(); flush_list()
            nodes.append({'tag': 'h4' if len(heading.group(1)) == 1 else 'h4', 'children': _inline_nodes(heading.group(2), uploads)})
            continue
        bullet = re.match(r'^\s*[-*+]\s+(.*)$', line)
        if bullet:
            flush_paragraph(); list_items.append(bullet.group(1))
            continue
        if line.startswith('>'):
            flush_paragraph(); flush_list()
            nodes.append({'tag': 'blockquote', 'children': _inline_nodes(line.lstrip('> '), uploads)})
            continue
        flush_list()
        paragraph.append(line)
    if code is not None:
        nodes.append({'tag': 'pre', 'children': [''.join(code)]})
    flush_paragraph(); flush_list()
    return nodes


def publish(markdown, title=None):
    """Create the article; returns its public URL."""
    first_line = next((line for line in markdown.splitlines() if line.strip()), 'Разбор')
    headline = title or re.sub(r'^[#*\s]+', '', first_line)[:120] or 'Разбор'
    uploads = _math_src
    nodes = markdown_to_nodes(markdown, uploads)
    result = _api('createPage', access_token=token(), title=headline,
                  author_name=AUTHOR, content=nodes, return_content='false')
    return result['url']


def summary(markdown, limit=900):
    """First readable paragraphs for the chat itself, without formulas' source."""
    text = re.sub(r'\$\$.+?\$\$', '⟨формула⟩', markdown, flags=re.S)
    text = re.sub(r'(?<!\$)\$[^$\n]+\$(?!\$)', '⟨формула⟩', text)
    text = re.sub(r'^#+\s*', '', text, flags=re.M)
    blocks = [b.strip() for b in text.split('\n\n') if b.strip()]
    out = ''
    for block in blocks:
        if len(out) + len(block) > limit:
            break
        out = (out + '\n\n' + block).strip()
    return out or blocks[0][:limit]
