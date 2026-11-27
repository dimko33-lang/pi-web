"""Shared Telegram final/tool delivery; no provider or prompt dependencies."""
from rich_replies import article_parts, send_article_reply, _math_markdown
import re
from telethon.tl.types import MessageEntityBlockquote
from telegram_blocks import message_parts, verify_blocks, units, _clip_entities


# A character threshold, not a promise about a client's viewport height.
PROSE_COLLAPSE_UNITS = 1800
PROSE_PREVIEW_CHARS = 500


def prose_parts(text):
    """Lossless ordinary Markdown with an expandable remainder; never math/code.

    The visible beginning is an excerpt, not an invented AI summary. All chunks
    retain the original order and formatting. Later chunks are wholly collapsed.
    """
    if _math_markdown(text) is not None or '`' in text or '~~~' in text:
        return None
    parts = list(message_parts(text, formatted=True))
    if sum(units(body) for body, _ in parts) <= PROSE_COLLAPSE_UNITS:
        return None
    result = []
    for index, (body, entities) in enumerate(parts):
        offset = 0
        if index == 0:
            # Prefer a complete introductory paragraph, then a full sentence.
            candidates = [m.end() for m in re.finditer(r'\n\s*\n', body)
                          if 100 <= m.end() <= PROSE_PREVIEW_CHARS]
            if not candidates:
                candidates = [m.end() for m in re.finditer(r'[.!?…](?:\s+|$)', body)
                              if 100 <= m.end() <= PROSE_PREVIEW_CHARS]
            if candidates:
                cut = candidates[0]
            else:
                cut = body.rfind(' ', 100, PROSE_PREVIEW_CHARS)
                if cut < 0:
                    cut = min(PROSE_PREVIEW_CHARS, len(body))
            offset = units(body[:cut])
            # Prevent an entity from straddling the quote boundary.
            entities = (_clip_entities(entities, 0, offset) +
                        [_shift_entity(e, offset) for e in
                         _clip_entities(entities, offset, units(body)-offset)])
        if offset < units(body):
            entities = sorted([*entities, MessageEntityBlockquote(
                offset=offset, length=units(body)-offset, collapsed=True)],
                key=lambda e: (e.offset, -e.length))
        result.append((body, entities))
    return result


def _shift_entity(entity, offset):
    entity.offset += offset
    return entity


class DeliveryUncertain(RuntimeError):
    """A send was attempted: never replay the answer or its prefix automatically."""


async def deliver_reply(client, chat_id, source_id, text, *, force_article=False, receipts=None):
    def confirmed(mid):
        if receipts is not None: receipts.append(mid)
        return mid
    if type(source_id) is not int or source_id <= 0:
        raise ValueError('A genuine incoming Telegram message ID is required')
    from public_site import allowed_destination, should_publish, publish, link_message
    from conversation_profiles import SALON_CHAT_ID
    if chat_id == SALON_CHAT_ID:
        from showcase_reply import deliver_showcase
        async def notes_link(peer, source, answer):
            return link_message(answer, await publish(peer, source, answer))
        return confirmed(await deliver_showcase(client, chat_id, source_id, text, force_article=force_article,
                                      notes=notes_link if allowed_destination(chat_id) else None))
    # Native Telegram article formatting is not a request to publish a web page.
    if should_publish(chat_id, text):
        # Publication/read-back happens BEFORE attempting Telegram. A web failure
        # can safely retain the existing in-chat route; a send failure cannot.
        try:
            public_url = await publish(chat_id, source_id, text)
        except Exception:
            import logging
            logging.getLogger(__name__).exception('Public site unavailable; retaining complete in-chat answer')
        else:
            try:
                sent = await client.send_message(chat_id, link_message(text, public_url),
                    reply_to=source_id, parse_mode=None, link_preview=False)
                message_id = getattr(sent, 'id', None)
                if message_id is None:
                    raise DeliveryUncertain('Public answer link delivery uncertain; not resending')
                return confirmed(message_id)
            except Exception as exc:
                raise DeliveryUncertain('Public answer link delivery uncertain; not resending') from exc
    collapsed = prose_parts(text)
    parts = [] if collapsed else (article_parts(text, force=force_article or units(text) > 3900) or [])
    last_id = None
    try:
        if collapsed:
            for body, entities in collapsed:
                sent = await client.send_message(chat_id, body, reply_to=source_id,
                    parse_mode=None, formatting_entities=entities, link_preview=False)
                last_id = getattr(sent, 'id', None)
                if last_id is None:
                    raise DeliveryUncertain('Collapsed prose delivery is uncertain; not resending')
                confirmed(last_id)
                await verify_blocks(client, chat_id, sent, entities)
        elif parts:
            for part in parts:
                last_id = await send_article_reply(client, chat_id, source_id, part)
                if last_id is None:
                    raise DeliveryUncertain('Native article delivery is uncertain; not resending')
                confirmed(last_id)
        else:
            # Oversized indivisible math/code retains its full source in bounded messages.
            # Markdown parsing could consume literal underscores/stars in oversized TeX.
            formatted = _math_markdown(text) is None
            for body, entities in message_parts(text, formatted=formatted):
                sent = await client.send_message(chat_id, body, reply_to=source_id,
                    parse_mode=None, formatting_entities=entities, link_preview=False)
                last_id = getattr(sent, 'id', None)
                if last_id is None:
                    raise DeliveryUncertain('Message delivery is uncertain; not resending')
                confirmed(last_id)
                await verify_blocks(client, chat_id, sent, entities)
    except DeliveryUncertain:
        raise
    except Exception as exc:
        # A timeout/disconnect can occur after acceptance, even on the first part.
        # Do not infer non-delivery from an exception, nor resend a confirmed prefix.
        raise DeliveryUncertain('Reply delivery failed or is uncertain; not resending') from exc
    return last_id
