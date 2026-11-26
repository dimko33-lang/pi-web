"""Private outgoing salon feeds. No second Telegram session, model calls or sends."""
import asyncio
import fcntl
import json
import logging
import os
from pathlib import Path
import tempfile

GROUPS = ('piwep', 'curvelab', 'arri', 'lightcone', 'lake')
PAGE = 100
log = logging.getLogger(__name__)


def read(path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(value, out, ensure_ascii=False, separators=(',', ':')); out.flush(); os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def showcase_enabled(base, peer):
    if type(peer) is not int or peer >= 0:
        return False
    selected = read(base / 'showcase-bindings.json', {})
    for tab, bound in selected.items():
        if tab in GROUPS and bound == peer:
            return all(read(base / filename, {}).get(tab) == peer
                       for filename in ('archive-bindings.json', 'reply-bindings.json'))
    return False


def bind(base, profile, peer, authors=False, replies=None, showcase=None, circles=None):
    if circles and profile == 'lightcone':
        raise ValueError('Circle requests are not eligible for LightCone recovery.')
    if authors and profile != 'lightcone':
        raise ValueError('The author reader can only use the LightCone tab.')
    if profile not in GROUPS or peer >= 0:
        raise ValueError('Choose a salon group tab and a negative Telegram chat ID.')
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = base / 'archive-bindings.json'
    with (base / 'bindings.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        mapping = read(path, {})
        if profile in mapping and mapping[profile] != peer:
            raise ValueError('Tab already bound; refusing to mix two histories.')
        if any(k != profile and v == peer for k, v in mapping.items()):
            raise ValueError('Chat already bound to another tab.')
        mapping[profile] = peer; atomic(path, mapping)
        # An existing archive binding never silently grants permission to speak.
        if replies is not None:
            allowed = read(base / 'reply-bindings.json', {})
            if replies: allowed[profile] = peer
            else: allowed.pop(profile, None)
            atomic(base / 'reply-bindings.json', allowed)
        if circles is not None:
            routes = read(base / 'circle-bindings.json', {})
            if circles: routes[profile] = peer
            else: routes.pop(profile, None)
            atomic(base / 'circle-bindings.json', routes)
        if showcase is not None:
            formats = read(base / 'showcase-bindings.json', {})
            if showcase: formats[profile] = peer
            else: formats.pop(profile, None)
            atomic(base / 'showcase-bindings.json', formats)
        if authors:
            atomic(base / 'authors-binding.json', {'peer': peer})


class SalonArchive:
    def __init__(self, base, owner):
        self.base, self.owner = base, owner
        self.wake = asyncio.Event(); self.peers = {owner}; self.first_event = {}; self.reader_peer = None

    def notify(self, peer, mid):
        if peer in self.peers and mid > 0:
            self.first_event.setdefault(peer, mid); self.wake.set()

    async def publish_authors(self, client, page):
        dest = self.base / 'authors'
        grouped = {}
        for m in page:
            if not (m.message or '').strip() or not m.sender_id: continue
            key = ('user' if m.sender_id > 0 else 'channel') + str(abs(m.sender_id))
            if key not in grouped:
                sender = await m.get_sender()
                title = getattr(sender,'title',None) or ' '.join(filter(None,[getattr(sender,'first_name',None),getattr(sender,'last_name',None)]))
                grouped[key] = (title, [])
            grouped[key][1].append({'id':m.id,'date':int(m.date.timestamp()),'text':m.message})
        if not grouped: return
        index = {r['id']:r for r in read(dest / 'index.json', [])}
        for key,(title,items) in grouped.items():
            file = dest / (key + '.json'); rows = {r['id']:r for r in read(file, [])}
            rows.update((r['id'],r) for r in items)
            atomic(file,sorted(rows.values(), key=lambda r:r['id'], reverse=True))
            index[key] = {'id':key,'name':title or index.get(key,{}).get('name') or key,'count':len(rows)}
        atomic(dest / 'index.json',sorted(index.values(),key=lambda r:(-r['count'],r['id'])))

    async def page(self, client, profile, peer):
        dest = self.base / 'archive' / profile
        state = read(dest / 'cursor.json', None)
        if state and state['peer'] != peer:
            raise ValueError('Archive peer mismatch')
        tip = await client.get_messages(peer, limit=1)
        head = tip[0].id if tip else 0
        if state is None:
            # Start clean, not by silently copying old history. Include a waking event.
            cursor = min(head, self.first_event.get(peer, head + 1) - 1)
            atomic(dest / 'cursor.json', {'peer': peer, 'last': cursor})
        else:
            cursor = state['last']
        self.first_event.pop(peer, None)
        if head <= cursor:
            return
        page = await client.get_messages(peer, min_id=cursor, max_id=head+1, reverse=True, limit=PAGE)
        fresh = []
        for m in page:
            if not m.out: continue
            # Use the salon's existing feed schema; do not export the whole Telegram object.
            key = f'{abs(peer)}-{m.id}'
            text = m.message or ''
            if not text and getattr(m, 'video_note', None):
                text = read(self.base / 'circle-transcripts' / str(peer) / f'{m.id}.json', '')
            if not text and getattr(m, 'rich_message', None) and showcase_enabled(self.base, peer):
                from rich_replies import message_text
                text = message_text(m)
            row = {'key': key, 'original': {'id': m.id, 'date_unixtime': int(m.date.timestamp())}, 'text': text}
            if str(peer).startswith('-100'):
                row['link'] = f'https://t.me/c/{str(peer)[4:]}/{m.id}'
            if m.photo:
                image = dest / (key + '.jpg')
                if not image.exists():
                    fd, tmp = tempfile.mkstemp(dir=dest)
                    try:
                        with os.fdopen(fd, 'w+b') as output:
                            await client.download_media(m, file=output); output.flush(); output.seek(0)
                            if output.read(2) != b'\xff\xd8': raise ValueError('Incomplete JPEG download')
                            os.fsync(output.fileno())
                        os.replace(tmp, image)
                    finally:
                        Path(tmp).unlink(missing_ok=True)
                row.update(file=image.name, kind='jpg', filename=image.name)
            if row['text'] or row.get('file'): fresh.append(row)
        if fresh:
            rows = {r['key']: r for r in read(dest / 'messages.json', [])}
            rows.update((r['key'], r) for r in fresh)
            atomic(dest / 'messages.json', sorted(rows.values(), key=lambda r:r['original']['id'], reverse=True))
        if profile == 'lightcone' and read(self.base / 'authors-binding.json', {}).get('peer') == peer:
            await self.publish_authors(client, page)
        # Commit last: after a crash, replay replaces rows rather than duplicating them.
        last = max(m.id for m in page) if page else head
        atomic(dest / 'cursor.json', {'peer': peer, 'last': last})
        if last < head: self.wake.set()

    async def run(self, client):
        primed = set()
        while True:
            self.wake.clear()
            try:
                groups = read(self.base / 'archive-bindings.json', {})
                mapping = {k:v for k,v in groups.items() if k in GROUPS and type(v) is int and v < 0}
                mapping['owner_dm'] = self.owner; self.peers = set(mapping.values())
                self.reader_peer = read(self.base / 'authors-binding.json', {}).get('peer')
                if self.peers - primed:
                    # StringSession persists authorization, not the entity cache.
                    async for _ in client.iter_dialogs(): pass
                    primed = self.peers.copy()
                for name, peer in mapping.items():
                    try: await self.page(client, name, peer)
                    except Exception as e: log.warning('Archive %s deferred: %s', name, type(e).__name__)
            except Exception as e:
                log.warning('Archive settings deferred: %s', type(e).__name__)
            try: await asyncio.wait_for(self.wake.wait(), timeout=180)
            except asyncio.TimeoutError: pass
