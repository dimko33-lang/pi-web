"""Native-first delivery for an explicitly selected showcase group. Never replay an uncertain send."""
import io
import logging
import re
from telethon import errors, functions
from rich_replies import _math_markdown, send_article_reply
from telegram_blocks import message_parts, units, verify_blocks

log = logging.getLogger(__name__)
VISUAL = re.compile(r'^```(?:plotly|diagram)[ \t]*\r?$', re.M)
TEXT_REJECTED = {'MESSAGE_TOO_LONG', 'ENTITIES_TOO_LONG', 'ENTITY_BOUNDS_INVALID'}
ARTICLE_REJECTED = TEXT_REJECTED | {'RICH_MESSAGE_TOO_LONG', 'RICH_MESSAGE_TOO_LARGE', 'RICH_MESSAGE_INVALID',
    'RICH_MESSAGE_NOT_SUPPORTED', 'RICH_MESSAGE_PARSE_FAILED', 'RICH_MESSAGE_MARKDOWN_INVALID', 'MESSAGE_EMPTY'}


def format_refusal(exc, allowed):
    # Generated Telethon subclasses often inherit message='BAD_REQUEST' rather than the RPC name.
    kind = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', type(exc).__name__.removesuffix('Error')).upper()
    return kind in allowed or exc.message in allowed


def sent_id(value):
    mid = getattr(value, 'id', value)
    if type(mid) is not int or mid <= 0:
        raise RuntimeError('Showcase delivery uncertain; do not resend')
    return mid


async def plain_limit(client):
    # Telegram defines message_length_max in Unicode code points, not entity (UTF-16) offsets.
    limit = getattr(client, '_nikita_plain_limit', None)
    if type(limit) is int and limit > 0:
        return limit
    try:
        limit = (await client(functions.help.GetConfigRequest())).message_length_max
        if type(limit) is int and limit > 0:
            client._nikita_plain_limit = limit
            return limit
    except Exception:
        log.info('Telegram message length config unavailable; using the standard text budget')
    return 4096


async def deliver_showcase(client, peer, source, text, *, force_article=False, notes=None):
    """Return one reply ID. notes prepares a verified link without sending anything to Telegram."""
    if type(peer) is not int or peer >= 0 or type(source) is not int or source <= 0:
        raise ValueError('A source-bound group reply is required')
    if not isinstance(text, str) or not text.strip():
        raise ValueError('An empty showcase reply cannot be sent')

    async def note_link():
        try:
            link_text = await notes(peer, source, text)
            if not isinstance(link_text, str) or not link_text.strip():
                raise ValueError('No verified article link')
        except Exception as exc:
            log.warning('Showcase note unavailable (%s); retaining the full answer', type(exc).__name__)
            return None
        # Separate preparation from delivery: a missing receipt is not permission to send twice.
        return sent_id(await client.send_message(peer, link_text, reply_to=source, parse_mode=None, link_preview=False))

    visual = bool(VISUAL.search(text))
    if visual and notes:
        mid = await note_link()
        if mid is not None:
            return mid

    math = _math_markdown(text)
    if not force_article and not visual and math is None:
        # Measure rendered text: Markdown delimiters/URLs are not visible message characters.
        rendered = list(message_parts(text, limit=max(2, units(text)), formatted=True))
        if len(rendered) == 1:
            body, entities = rendered[0]
            if len(body) <= await plain_limit(client):
                try:
                    post = await client.send_message(peer, body, reply_to=source, formatting_entities=entities,
                                                     parse_mode=None, link_preview=False)
                except errors.BadRequestError as exc:
                    if not format_refusal(exc, TEXT_REJECTED):
                        raise
                else:
                    mid = sent_id(post)
                    await verify_blocks(client, peer, post, entities)
                    return mid

    # Never split or impose a model length budget. Let Telegram accept one complete article.
    try:
        return sent_id(await send_article_reply(client, peer, source, math if math is not None else text))
    except errors.BadRequestError as exc:
        if not format_refusal(exc, ARTICLE_REJECTED):
            raise
        log.info('Telegram rejected the showcase article format/size: %s (%s)', type(exc).__name__, exc.message)
    if notes and not visual:
        mid = await note_link()
        if mid is not None:
            return mid
    # Without a verified Notes publisher, keep the answer in this chat. No private index URL.
    document = io.BytesIO(text.encode('utf-8'))
    document.name = 'reply.md'
    return sent_id(await client.send_file(peer, document, reply_to=source, force_document=True))
