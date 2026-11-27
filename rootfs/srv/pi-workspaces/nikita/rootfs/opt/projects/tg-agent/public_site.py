"""Public answer delivery for authorized Telegram conversations, not history export."""
import asyncio
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import secrets
import urllib.request

PUBLIC_CHAT = -@@PROJECT_PEER@@
ROOT = Path('/var/lib/nikita-publications')
BASE = 'https://@@SITE_HOST@@/nikita/'
MAX_BYTES = 500000
# Match the sender's conservative single-message budget (telegram_blocks.message_parts).
# Count the full Markdown/LaTeX source; this is a routing boundary, not an answer length cap.
PUBLICATION_THRESHOLD = 3900


def allowed_destination(chat_id):
    # Caller is the existing authorized, source-bound reply transport. This does
    # not add any admission or cross-chat sending rights.
    if type(chat_id) is not int or chat_id == 0:
        return False
    mode = os.environ.get('NIKITA_PUBLIC_SITE')
    return mode == 'all-chats-v1' or (mode == 'piweb-test-v1' and chat_id == PUBLIC_CHAT)


def should_publish(chat_id, text, force=False):
    return allowed_destination(chat_id) and (force or len(text.encode('utf-16-le'))//2 > PUBLICATION_THRESHOLD
        or bool(re.search(r'^```(?:plotly|diagram)\s*$', text, re.M)))


def with_paths(rows):
    """Stable readable permalinks; old document IDs are internal, not passwords."""
    translit = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
        ['a','b','v','g','d','e','yo','zh','z','i','i','k','l','m','n','o','p','r','s','t','u','f','kh','ts','ch','sh','shch','','y','','e','yu','ya']))
    used = set()
    result = []
    for original in rows:
        row = dict(original)
        slug = row.get('slug', '')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}/[a-z0-9]+(?:-[a-z0-9]+)*', slug) or slug in used:
            title = ''.join(translit.get(c,c) for c in row['title'].lower())
            title = re.sub(r'[^a-z0-9]+', '-', title).strip('-')[:72].rstrip('-') or 'zametka'
            day = row['created'][:10]
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
                raise ValueError('Invalid publication date')
            base = day+'/'+title
            slug, number = base, 2
            while slug in used:
                slug = base+'-'+str(number)
                number += 1
        row['slug'] = slug
        used.add(slug)
        result.append(row)
    return result


def public_url(identity, *, root=ROOT):
    rows = json.loads((root/'index.owner.json').read_text())
    row = next(r for r in rows if r['id'] == identity)
    slug = row.get('slug', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}/[a-z0-9]+(?:-[a-z0-9]+)*', slug):
        raise ValueError('Missing publication permalink')
    token = row.get('share', '')
    if not re.fullmatch('[a-f0-9]{32}', token):
        raise ValueError('Missing article capability')
    return BASE+slug+'/?a='+token


def grant_article(root, row):
    # Called under the publication lock. Only this immutable JSON is linked.
    if not re.fullmatch('[a-f0-9]{24}', row['id']) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}/[a-z0-9]+(?:-[a-z0-9]+)*', row['slug']):
        raise ValueError('Invalid article identity')
    src = root/(row['id']+'.json')
    if src.is_symlink() or not src.is_file(): raise ValueError('Missing article')
    folder = root
    for name in ('.article-links', *row['slug'].split('/')):
        folder = folder/name
        if not folder.exists():
            folder.mkdir()
            folder.chmod(0o755)
        if folder.is_symlink() or not folder.is_dir(): raise ValueError('Invalid grant directory')
    token = row.setdefault('share', secrets.token_hex(16))
    if not re.fullmatch('[a-f0-9]{32}', token): raise ValueError('Invalid article capability')
    dst = folder/(token+'.json')
    if not dst.exists(): os.link(src, dst)
    if dst.is_symlink() or not src.samefile(dst): raise ValueError('Article capability collision')


def _atomic(path, payload):
    fd, name = tempfile.mkstemp(prefix='.new-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def store(chat_id, source_id, text, *, root=ROOT):
    if not allowed_destination(chat_id) or type(source_id) is not int or source_id <= 0:
        raise ValueError('An enabled, source-bound reply destination is required')
    if not isinstance(text, str) or not text.strip() or len(text.encode()) > MAX_BYTES:
        raise ValueError('Public answer must be nonempty and <=500000 UTF8 bytes')
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Publication root unavailable')
    identity = hashlib.sha256(f'{chat_id}:{source_id}:'.encode()+text.encode()).hexdigest()[:24]
    path = root / (identity+'.json')
    title = next((line.strip().lstrip('#').strip() for line in text.splitlines() if line.strip()), 'Ответ Никиты')[:120]
    with (root/'.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.is_symlink() or (root/'index.json').is_symlink():
            raise ValueError('Symlinks not accepted')
        if path.exists():
            payload = path.read_bytes()
            if json.loads(payload).get('body') != text:
                raise ValueError('Publication collision')
            record = json.loads(payload)
        else:
            record = dict(id=identity, title=title, created=datetime.now(timezone.utc).isoformat(), body=text)
            payload = json.dumps(record, ensure_ascii=False).encode()
            _atomic(path, payload)
        index_path = root/'index.json'
        owner_path = root/'index.owner.json'
        if owner_path.is_symlink(): raise ValueError('Invalid private index')
        rows = json.loads(owner_path.read_text()) if owner_path.exists() else (json.loads(index_path.read_text()) if index_path.exists() else [])
        previous = next((r for r in rows if r['id'] == identity), None)
        if previous is None:
            rows.append({k:record[k] for k in ('id','title','created')})
        # Preserve existing paths before sorting new entries: duplicates must
        # never rename an already published article.
        rows = with_paths(rows)
        grant_article(root, next(r for r in rows if r['id'] == identity))
        rows.sort(key=lambda r:r['created'], reverse=True)
        _atomic(owner_path, json.dumps(rows, ensure_ascii=False).encode())
        _atomic(index_path, json.dumps([{k:v for k,v in r.items() if k!='share'} for r in rows], ensure_ascii=False).encode())
    return identity, payload


def _publish(chat_id, source_id, text):
    identity, payload = store(chat_id, source_id, text)
    # Fixed public origin only. Never fetch a URL supplied by the model.
    url = public_url(identity)
    request = urllib.request.Request(url.replace('/?a=', '/read/')+'.json', headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(request, timeout=10) as response:
        actual = response.read(MAX_BYTES+10000)
        if response.status != 200 or actual != payload:
            raise RuntimeError('Public read-back mismatch; no Telegram link sent')
    return url


async def publish(chat_id, source_id, text):
    return await asyncio.to_thread(_publish, chat_id, source_id, text)


def link_message(text, url):
    # An original excerpt, not another model-generated summary.
    plain = re.sub(r'```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]', '', text)
    plain = re.sub(r'(?m)^#+\s*', '', plain)
    plain = re.sub(r'\[([^\]]+)\]\([^\n)]*\)', r'\1', plain)
    plain = re.sub(r'[*_`]', '', plain).strip()
    paragraph = next((p.strip() for p in re.split(r'\n\s*\n', plain) if len(p.strip()) >= 60), plain)
    if len(paragraph) > 500:
        end = paragraph.rfind(' ', 0, 500)
        paragraph = paragraph[:end if end > 200 else 500].rstrip()+'…'
    return (paragraph or 'Полный ответ с формулами, графиками и пояснениями — на странице.')+'\n\nПолный ответ: '+url
