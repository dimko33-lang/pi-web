"""Event-driven LightCone reader with ordered, restart-safe gap recovery."""
import asyncio
import json
import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger('nikita')
CHAT_ID = -@@LC_PEER@@
LIVE = Path(os.environ.get('NIKITA_LIVE_ARCHIVE', '/opt/projects/lightcone-reader/live'))
# Read-only full snapshot as visible inside the service (bind mount), used as the
# historical base for authors that have no live copy yet.
SOURCE = Path(os.environ.get('NIKITA_ARCHIVE_SOURCE', '/opt/nikita-lightcone-archive/messages'))
BATCH = 200
STATE = LIVE / '.last-synced'
MSK = ZoneInfo('Europe/Moscow')


def _atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _load(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _author_id(sender_id, kind):
    return ('channel' if kind == 'channel' else 'user') + str(sender_id)


def _record(author_id, name, text, message):
    stamp = datetime.fromtimestamp(message.date.timestamp(), MSK).strftime('%Y-%m-%dT%H:%M:%S') if message.date else ''
    return {
        'author_id': author_id, 'role': 'author', 'source_index': 0, 'text': text,
        'entities': [{'type': 'plain', 'text': text}], 'attachments': {},
        'reply_resolution': 'present_this_chat' if message.reply_to_msg_id else 'none',
        'original': {
            'id': message.id, 'type': 'message', 'date': stamp,
            'date_unixtime': str(int(message.date.timestamp())) if message.date else '',
            'from': name, 'from_id': author_id,
            **({'reply_to_message_id': message.reply_to_msg_id} if message.reply_to_msg_id else {}),
            'text': text, 'text_entities': [{'type': 'plain', 'text': text}],
        },
    }


def _append(messages_path, author_entry, new_records, source_path=None):
    data = _load(messages_path, None)
    if data is None and source_path is not None:
        data = _load(source_path, None)
    if data is None:
        data = {'author': author_entry, 'messages': []}
    messages = data.get('messages') or []
    known = {m.get('original', {}).get('id') for m in messages}
    messages.extend(r for r in new_records if r['original']['id'] not in known)
    messages.sort(key=lambda m: m.get('original', {}).get('id', 0))
    for index, item in enumerate(messages):
        item['source_index'] = index
    author = dict(data.get('author') or {})
    author.update(author_entry)
    author.update(message_count=len(messages), file=f"messages/{author_entry['id']}.json")
    _atomic(messages_path, json.dumps({'author': author, 'messages': messages}, ensure_ascii=False))
    return author


def _name(sender):
    if sender is None:
        return 'user', 'Неизвестный'
    kind = 'channel' if getattr(sender, 'title', None) else 'user'
    text = getattr(sender, 'title', None) or ' '.join(
        str(getattr(sender, key, None) or '') for key in ('first_name', 'last_name')).strip()
    return kind, (text or 'Имя отсутствует')


async def publish(messages):
    fresh = sorted((m for m in messages if not m.out and (m.message or '').strip()),
                   key=lambda m: m.id)
    if not fresh:
        return {'new': 0}
    group = {}
    for message in fresh:
        sender = None
        try:
            sender = await message.get_sender()
        except Exception:
            pass
        kind, name = _name(sender)
        author_id = _author_id(getattr(message, 'sender_id', None) or 0, kind)
        group.setdefault((author_id, name), []).append(message)
    authors_path = LIVE / 'authors.json'
    authors = _load(authors_path, [])
    by_id = {a.get('id'): a for a in authors if isinstance(a, dict)}
    added = 0
    for (author_id, name), items in group.items():
        messages_path = LIVE / 'messages' / f'{author_id}.json'
        records = [_record(author_id, name, item.message.strip(), item) for item in items]
        entry = by_id.get(author_id) or {'id': author_id, 'author_id': author_id,
                                         'display_name': name, 'names': [name],
                                         'type': 'channel' if author_id.startswith('channel') else 'user',
                                         'message_count': 0}
        entry['display_name'] = entry.get('display_name') or name
        author = _append(messages_path, entry, records, SOURCE / f'{author_id}.json')
        by_id[author_id] = author
        added += len(records)
    if authors:
        merged = list(by_id.values())
        merged.sort(key=lambda a: a.get('message_count', 0), reverse=True)
        _atomic(authors_path, json.dumps(merged, ensure_ascii=False, separators=(',', ':')))
    log.info('LightCone reader published records=%s authors=%s last_id=%s', added, len(group), max(m.id for m in fresh))
    return {'new': added, 'authors': len(group)}


class ReaderUpdates:
    def __init__(self):
        self.ready = asyncio.Event()
        self.tip = 0
        self.latest = None

    def notify(self, tip, message=None):
        if tip > self.tip:
            self.tip, self.latest = tip, message
            self.ready.set()

    async def run(self, client):
        while True:
            await self.ready.wait()
            self.ready.clear()
            try:
                # Require the existing durable checkpoint; never guess a new baseline.
                cursor = int(STATE.read_text().strip())
                while cursor < self.tip:
                    tip, message = self.tip, self.latest
                    if tip == cursor + 1 and message is not None:
                        page = [message]
                    else:
                        page = await client.get_messages(CHAT_ID, min_id=cursor, max_id=tip+1, reverse=True, limit=BATCH)
                    await publish(page)
                    cursor = max(m.id for m in page) if page else tip
                    _atomic(STATE, str(cursor))
            except Exception:
                log.exception('LightCone reader update deferred')
                await asyncio.sleep(30)
                self.ready.set()
