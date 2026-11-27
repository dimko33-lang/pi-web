"""Read-only Telegram search on the existing client. Never accept a model-selected chat."""
import asyncio
from datetime import timezone

PI_WEB = -@@PROJECT_PEER@@


async def recall(client, *, chat_id, profile, current_id, query, earliest=False):
    if chat_id != PI_WEB or not profile or not profile['memory'] or not profile.get('toolsOn', True):
        raise ValueError('Conversation recall is unavailable')
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 120 or type(current_id) is not int or current_id <= 0:
        raise ValueError('Invalid recall request')
    if type(earliest) is not bool:
        raise ValueError('Invalid search order')
    since = profile['memoryResetAt']
    def eligible(msg):
        return msg and msg.chat_id == PI_WEB and msg.id < current_id and msg.date.timestamp() * 1000 >= since
    def excerpt(msg):
        return {'id': msg.id, 'date': msg.date.astimezone(timezone.utc).isoformat(), 'text': (msg.raw_text or '')[:1400], 'url': f'https://t.me/c/@@PROJECT_PEER_SHORT@@/{msg.id}'}
    async def search():
        results = []
        seen = set()
        def add(parent, answer):
            if answer.id not in seen and not parent.out and answer.out and answer.reply_to_msg_id == parent.id:
                results.append({'request': excerpt(parent), 'answer': excerpt(answer)})
                seen.add(answer.id)
        async for msg in client.iter_messages(PI_WEB, search=query.strip(), max_id=current_id, limit=8, reverse=earliest):
            if not eligible(msg): continue
            # Only return the assistant's replies and the requests it actually answered.
            if msg.out and msg.reply_to_msg_id:
                parent = await client.get_messages(PI_WEB, ids=msg.reply_to_msg_id)
                if eligible(parent): add(parent, msg)
            elif not msg.out:
                ids = list(range(msg.id + 1, min(current_id, msg.id + 25)))
                replies = await client.get_messages(PI_WEB, ids=ids) if ids else []
                candidates = [r for r in replies if eligible(r) and r.out and r.reply_to_msg_id == msg.id]
                if candidates:
                    add(msg, next((r for r in candidates if r.raw_text), candidates[0]))
            if len(results) >= 4: break
        return {'matches': results, 'scope': 'Current conversation only. Bounded text search; absence does not prove no earlier match.'}
    return await asyncio.wait_for(search(), timeout=20)
