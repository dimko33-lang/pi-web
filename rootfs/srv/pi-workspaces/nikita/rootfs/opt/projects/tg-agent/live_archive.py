"""Live publication of this account's own LightCone messages for the public reader."""
import json
import logging
import os
import tempfile
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

MSK = ZoneInfo('Europe/Moscow')

log = logging.getLogger('nikita')
LIVE = Path(os.environ.get('NIKITA_LIVE_ARCHIVE', '/opt/projects/lightcone-reader/live'))
AUTHOR_ID = 'user@@ACCOUNT_ID@@'
DISPLAY_NAME = 'Никита Сократ'


def _write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _read(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def record(text, message_id, date=None):
    """Build one archive record in the same shape as the exported snapshot."""
    when = date or time.time()
    stamp = datetime.fromtimestamp(when, MSK).strftime('%Y-%m-%dT%H:%M:%S')
    return {
        'author_id': AUTHOR_ID,
        'role': 'author',
        'source_index': 0,
        'text': text,
        'entities': [{'type': 'plain', 'text': text}],
        'attachments': {},
        'reply_resolution': 'present_this_chat',
        'original': {
            'id': int(message_id),
            'type': 'message',
            'date': stamp,
            'date_unixtime': str(int(when)),
            'from': DISPLAY_NAME,
            'from_id': AUTHOR_ID,
            'text': text,
            'text_entities': [{'type': 'plain', 'text': text}],
        },
    }


def publish(text, message_id, date=None):
    """Append one own message; ignore repeats so a retry cannot duplicate it."""
    text = (text or '').strip()
    if not text or not message_id:
        return False
    path = LIVE / 'messages' / f'{AUTHOR_ID}.json'
    data = _read(path, {'author': {}, 'messages': []})
    messages = data.get('messages') or []
    if any(m.get('original', {}).get('id') == int(message_id) for m in messages):
        return False
    messages.append(record(text, message_id, date))
    messages.sort(key=lambda m: m.get('original', {}).get('id', 0))
    for index, item in enumerate(messages):
        item['source_index'] = index
    author = data.get('author') or {}
    author.update({'id': AUTHOR_ID, 'author_id': AUTHOR_ID, 'display_name': DISPLAY_NAME,
                   'names': ['Никита Сократ', 'nikita', '@@BOT_HANDLE@@', 'Nikita Socrates'],
                   'type': 'user', 'message_count': len(messages),
                   'file': f'messages/{AUTHOR_ID}.json'})
    _write_atomic(path, json.dumps({'author': author, 'messages': messages}, ensure_ascii=False))
    authors_path = LIVE / 'authors.json'
    authors = _read(authors_path, [])
    if isinstance(authors, list):  # A genuinely empty index acquires its first real author here.
        authors = [a for a in authors if a.get('id') != AUTHOR_ID] + [author]
        authors.sort(key=lambda a: a.get('message_count', 0), reverse=True)
        _write_atomic(authors_path, json.dumps(authors, ensure_ascii=False, separators=(',', ':')))
    log.info('Live archive appended message_id=%s total=%s', message_id, len(messages))
    return True
