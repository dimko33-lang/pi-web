"""Literal copy blocks, with opt-in Markdown entities for ordinary chat replies."""
import re
import logging
import copy
from telethon.extensions import markdown as tg_markdown
from telethon.helpers import add_surrogate, del_surrogate, strip_text
from telethon.tl.types import MessageEntityPre

FENCE = re.compile(r'^(`{3,}|~{3,})([^\n]*)\n(.*?)^\1[ \t]*(?:\n|$)', re.M | re.S)


def units(text):
    return len(text.encode('utf-16-le')) // 2


def _message_parts(text, limit=3900):
    """Split in UTF-16 units, retaining pre entities even across messages."""
    spans = []
    pos = 0
    for match in FENCE.finditer(text):
        spans.append((text[pos:match.start()], None))
        spans.append((match[3], match[2].strip()))
        pos = match.end()
    spans.append((text[pos:], None))
    body, entities, size = '', [], 0
    for value, language in spans:
        while value:
            available = limit - size
            n, used = 0, 0
            for char in value:
                width = 2 if ord(char) > 0xffff else 1
                if used + width > available:
                    break
                n += 1
                used += width
            if n:
                body += value[:n]
                if language is not None:
                    entities.append(MessageEntityPre(size, used, language))
                size += used
                value = value[n:]
            if value or size == limit:
                yield body, entities
                body, entities, size = '', [], 0
    if body:
        yield body, entities


def _formatted_parts(text, limit):
    """Parse only outside fenced blocks, then clip entities at UTF-16 boundaries."""
    spans = []
    pos = 0
    for match in FENCE.finditer(text):
        spans.extend(((text[pos:match.start()], None), (match[3], match[2].strip())))
        pos = match.end()
    spans.append((text[pos:], None))
    segments, all_entities, offset = [], [], 0
    for value, language in spans:
        if language is not None:
            rendered = value
            local = [MessageEntityPre(0, units(value), language)] if value else []
        elif value.strip():
            left = value[:len(value)-len(value.lstrip())]
            right = value[len(value.rstrip()):]
            rendered, local = tg_markdown.parse(value.strip())
            for entity in local:
                entity.offset += units(left)
            rendered = left + rendered + right
        else:
            rendered, local = value, []
        for entity in local:
            entity.offset += offset
        all_entities.extend(local)
        segments.append(rendered)
        offset += units(rendered)
    body = ''.join(segments)
    start_chars = start_units = size = 0
    for i, char in enumerate(body):
        width = 2 if ord(char) > 0xffff else 1
        if size + width > limit:
            yield body[start_chars:i], _clip_entities(all_entities, start_units, size)
            start_chars, start_units, size = i, start_units + size, 0
        size += width
    if size:
        yield body[start_chars:], _clip_entities(all_entities, start_units, size)


def _clip_entities(entities, start, size):
    clipped = []
    for entity in entities:
        left, right = max(start, entity.offset), min(start+size, entity.offset+entity.length)
        if left < right:
            item = copy.copy(entity)
            item.offset, item.length = left-start, right-left
            clipped.append(item)
    return clipped


def message_parts(text, limit=3900, *, formatted=False):
    # Explicit entities bypass Telethon's normal parser/whitespace normalization.
    if limit < 2:
        raise ValueError("limit must be at least 2 UTF-16 units")
    parts = _formatted_parts(text, limit) if formatted else _message_parts(text, limit)
    for body, entities in parts:
        body = del_surrogate(strip_text(add_surrogate(body), entities))
        if body:
            yield body, entities


async def verify_blocks(client, peer, sent, expected):
    """Read back formatting; never resend on uncertain delivery."""
    if not expected:
        return
    log = logging.getLogger(__name__)
    try:
        delivered = await client.get_messages(peer, ids=sent.id)
        expected_types = {type(e) for e in expected}
        actual = [e.to_dict() for e in (getattr(delivered, 'entities', None) or [])
                  if type(e) in expected_types]
        if actual != [e.to_dict() for e in expected]:
            log.error('Message formatting verification FAILED message_id=%s', sent.id)
        else:
            log.info('Message formatting verified message_id=%s', sent.id)
    except Exception:
        log.exception('Copy block readback failed message_id=%s; not resent', sent.id)
