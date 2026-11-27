"""Native Telegram math replies with bounded, lossless chunks and source-message binding."""
import re
import secrets
import logging

log = logging.getLogger('nikita')


def math_nodes(value):
    if hasattr(value, 'to_dict'):
        value = value.to_dict()
    if isinstance(value, dict):
        return int(value.get('_') in ('TextMath', 'PageBlockMath')) + sum(math_nodes(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return sum(math_nodes(v) for v in value)
    return 0
from telethon.tl import functions, types

FENCES = re.compile(r'(```[^\n]*\n.*?```|~~~[^\n]*\n.*?~~~)', re.S)
CODE = re.compile(FENCES.pattern + r'|(`+)[^`\n]*?\2', re.S)
MATH = re.compile(r'\\\(.*?\\\)|\\\[.*?\\\]|(?<!\\)\$\$.*?(?<!\\)\$\$|(?<![\\$])\$[^\n$]+?(?<!\\)\$', re.S)


def _math_markdown(text):
    """Normalize only math outside fenced code, without truncating the source."""
    parts, found, start = [], False, 0
    for code in list(CODE.finditer(text)) + [None]:
        end = code.start() if code is not None else len(text)
        plain = text[start:end]
        found = found or bool(MATH.search(plain))
        plain = re.sub(r'\\\[(.*?)\\\]', lambda m: '\n$$\n' + m[1].strip() + '\n$$\n', plain, flags=re.S)
        plain = re.sub(r'\\\((.*?)\\\)', lambda m: '$' + m[1] + '$', plain, flags=re.S)
        parts.append(plain)
        if code is not None:
            parts.append(code.group())
            start = code.end()
    return ''.join(parts) if found else None


def article_markdown(text):
    """Keep the existing bounded single-article contract for explicit tools/edits."""
    result = _math_markdown(text)
    if result is not None and not 1 <= len(result) <= 30000:
        raise ValueError('Native article must be 1..30000 characters')
    return result


def article_parts(text, limit=28000, *, force=False):
    """Split native math replies without cutting formulas, fences or UTF-16 characters.

    None means no math, or one indivisible block exceeds the native limit: keep the
    full source in ordinary chat messages rather than lose it or publish elsewhere.
    """
    if limit < 2:
        raise ValueError('Article limit must be at least two UTF-16 units')
    markdown = _math_markdown(text)
    if markdown is None:
        if not force:
            return None
        markdown = text
    protected, pos = [], 0
    for fence in CODE.finditer(markdown):
        protected.extend((match.start(), match.end()) for match in MATH.finditer(markdown, pos, fence.start()))
        protected.append((fence.start(), fence.end()))
        pos = fence.end()
    protected.extend((match.start(), match.end()) for match in MATH.finditer(markdown, pos))
    parts, start, block = [], 0, 0
    while start < len(markdown):
        end, used = start, 0
        while end < len(markdown):
            width = 2 if ord(markdown[end]) > 0xffff else 1
            if used + width > limit:
                break
            used += width
            end += 1
        if end == len(markdown):
            if not markdown[start:end].strip():
                return None
            parts.append(markdown[start:end])
            break
        while block < len(protected) and protected[block][1] <= start:
            block += 1
        for left, right in protected[block:]:
            if left >= end:
                break
            if left < end < right:
                end = left
                break
        if end <= start:
            return None
        # Prefer a paragraph boundary outside protected math/code. Never strip text.
        boundary = markdown.rfind('\n\n', start, end)
        while boundary > start:
            cut = boundary + 2
            if not any(left < cut < right for left, right in protected[block:] if left < cut):
                end = cut
                break
            boundary = markdown.rfind('\n\n', start, boundary)
        if not markdown[start:end].strip():
            return None
        parts.append(markdown[start:end])
        start = end
    return parts


def rich_text(value):
    """Readable native article content, not metadata or executable instructions."""
    if hasattr(value, 'to_dict'):
        value = value.to_dict()
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ''.join(rich_text(v) for v in value)
    if not isinstance(value, dict):
        return ''
    kind = value.get('_', '')
    if kind == 'TextMath':
        return '$' + value.get('source', '') + '$'
    if kind == 'PageBlockMath':
        return '\n$$' + value.get('source', '') + '$$\n'
    if 'texts' in value:
        return rich_text(value['texts'])
    if 'text' in value:
        result = rich_text(value['text'])
        return result + ('\n' if kind.startswith('PageBlock') else '')
    return '\n'.join(rich_text(value[k]) for k in ('blocks', 'items', 'caption', 'title') if k in value)


def message_text(message):
    plain = getattr(message, 'raw_text', None) or getattr(message, 'message', None) or ''
    from circle_transcripts import lookup
    return plain or rich_text(getattr(message, 'rich_message', None)) or lookup(message)


def rich_mentions(value, user_id):
    if hasattr(value, 'to_dict'):
        value = value.to_dict()
    if isinstance(value, dict):
        return (value.get('_') == 'TextMentionName' and value.get('user_id') == user_id) or any(rich_mentions(v, user_id) for v in value.values())
    if isinstance(value, list):
        return any(rich_mentions(v, user_id) for v in value)
    return False


def sent_id(updates):
    for update in getattr(updates, 'updates', []) or []:
        message = getattr(update, 'message', None)
        if message is not None and getattr(message, 'out', False) and getattr(message, 'id', None):
            return message.id
    return None


async def send_article_reply(client, chat_id, reply_id, markdown):
    peer = await client.get_input_entity(chat_id)
    result = await client(functions.messages.SendMessageRequest(
        peer=peer, message='', no_webpage=True, random_id=secrets.randbits(63),
        reply_to=types.InputReplyToMessage(reply_to_msg_id=reply_id),
        rich_message=types.InputRichMessageMarkdown(markdown=markdown)))
    delivered_id = sent_id(result)
    if delivered_id is not None:
        try:
            verified = await client.get_messages(chat_id, ids=delivered_id)
            rich = getattr(verified, 'rich_message', None)
            log.info('Native article read-back sent_id=%s rich=%s math_nodes=%s reply_to=%s', delivered_id, bool(rich), math_nodes(rich), getattr(verified, 'reply_to_msg_id', None))
        except Exception:
            log.warning('Native article submitted sent_id=%s; read-back unavailable, not retrying send', delivered_id)
    return delivered_id


async def edit_article(client, chat_id, message_id, markdown):
    peer = await client.get_input_entity(chat_id)
    await client(functions.messages.EditMessageRequest(
        peer=peer, id=message_id, message='', no_webpage=True,
        rich_message=types.InputRichMessageMarkdown(markdown=markdown)))
    verified = await client.get_messages(chat_id, ids=message_id)
    if not verified or not verified.out or not getattr(verified, 'rich_message', None):
        raise ValueError('Edit not verified as a native Telegram article; do not retry automatically')
    log.info('Native article edit read-back message_id=%s math_nodes=%s reply_to=%s', message_id, math_nodes(verified.rich_message), getattr(verified, 'reply_to_msg_id', None))
    return verified
