"""Length-dependent typing before delivery, refreshed until ready to send."""
import asyncio
import logging
from approval_state import OWNER_ID
from telethon import TelegramClient as BaseClient, functions, types, errors

log = logging.getLogger(__name__)
_SEND_TYPES = (functions.messages.SendMessageRequest,
               functions.messages.SendMediaRequest,
               functions.messages.SendMultiMediaRequest)


def typing_seconds(request):
    text = getattr(request, 'message', '') or ''
    for media in getattr(request, 'multi_media', ()) or ():
        text += getattr(media, 'message', '') or ''
    return min(120.0, max(30.0, len(text) / 15.0))


class TelegramClient(BaseClient):
    async def __call__(self, request, ordered=False, flood_sleep_threshold=None):
        requests = request if isinstance(request, (list, tuple)) else (request,)
        peers = []
        duration = 0.0
        for item in requests:
            if isinstance(item, _SEND_TYPES) and not getattr(item, 'schedule_date', None):
                peer = await self.get_input_entity(item.peer)
                # Owner DM and the project channel are latency-first, including tool sends.
                if isinstance(peer, types.InputPeerUser) and peer.user_id == OWNER_ID:
                    continue
                if isinstance(peer, types.InputPeerChannel) and peer.channel_id == @@PROJECT_PEER_SHORT@@:
                    continue
                if peer not in peers:
                    peers.append(peer)
                duration = max(duration, typing_seconds(item))
        # Refresh below Telegram's presence expiry. Failed presence never retries
        # delivery; broadcast channels may not support a typing indicator.
        active = list(peers)
        remaining = duration
        while remaining > 0:
            for peer in active[:]:
                try:
                    await super().__call__(functions.messages.SetTypingRequest(
                        peer=peer, action=types.SendMessageTypingAction()),
                        flood_sleep_threshold=0)
                except (errors.RPCError, OSError) as exc:
                    log.warning('Pre-send typing unavailable: %s', type(exc).__name__)
                    active.remove(peer)
            interval = min(4.0, remaining)
            await asyncio.sleep(interval)
            remaining -= interval
        return await super().__call__(request, ordered=ordered,
                                      flood_sleep_threshold=flood_sleep_threshold)
