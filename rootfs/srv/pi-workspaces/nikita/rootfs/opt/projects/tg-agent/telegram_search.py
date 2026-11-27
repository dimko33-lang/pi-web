"""Read-only search in the pinned conversation or an explicitly public Telegram channel/group."""
import asyncio
import re
from telethon import functions, types, utils


def public(chat):
    return isinstance(chat, types.Channel) and bool(chat.username) and not getattr(chat, 'noforwards', False)


async def search(client, origin, current_id, enabled, since, query, channel=None, earliest=False):
    if not enabled or type(origin) is not int or type(current_id) is not int or current_id <= 0:
        raise ValueError('Conversation search is unavailable')
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 120 or type(earliest) is not bool:
        raise ValueError('Invalid search query or order')
    async def run():
        peer = origin
        handle = None
        async def joined():
            return [d.entity async for d in client.iter_dialogs(limit=100) if isinstance(d.entity, (types.Chat, types.Channel)) and not any(getattr(d.entity,k,False) for k in ('left','deactivated','migrated_to','noforwards'))]

        async def collect(source, limit):
            pid = source if type(source) is int else utils.get_peer_id(source)
            same = pid == origin
            uname = getattr(source, 'username', None)
            rows = []
            async for m in client.iter_messages(source, search=query.strip(), limit=limit, reverse=earliest, max_id=current_id if same else 0):
                if same and (m.id >= current_id or m.date.timestamp()*1000 < since): continue
                if not m.raw_text or getattr(m,'noforwards',False): continue
                base = 'https://t.me/'+uname if uname else ('https://t.me/c/'+str(-pid-1000000000000) if pid < -1000000000000 else None)
                rows.append({'channel':getattr(source,'title','current conversation'),'id':m.id,'date':m.date.isoformat(),'text':m.raw_text[:1000],'url':base+'/'+str(m.id) if base else None})
            return rows

        if channel == 'subscriptions':
            sources = await joined()
            rows = []
            for source in sources[:12]: rows.extend(await collect(source, 3))
            rows.sort(key=lambda r:r['date'],reverse=not earliest)
            return {'matches':rows[:12],'sources_searched':min(12,len(sources)),'bounded':True}
        if channel is not None:
            if not isinstance(channel, str) or not 2 <= len(channel.strip()) <= 100:
                raise ValueError('Supply a public channel title or @username')
            name = channel.strip()
            match = re.fullmatch(r'(?:@|https://t\.me/)([A-Za-z][A-Za-z0-9_]{3,31})/?', name)
            if match:
                result = await client(functions.contacts.ResolveUsernameRequest(match[1]))
                matches = [c for c in result.chats if public(c) and utils.get_peer_id(c) == utils.get_peer_id(result.peer)]
            else:
                if name.startswith(('@','+','-')) or name.isdigit() or '/' in name:
                    raise ValueError('Private links, IDs and invite codes are not supported')
                own = [c for c in await joined() if c.title.casefold()==name.casefold()]
                if len(own)==1: return {'matches':await collect(own[0],8),'channel':own[0].title}
                if own: return {'notice':'Multiple joined groups have this title. Specify a public @username.'}
                result = await client(functions.contacts.SearchRequest(q=name,limit=12))
                public_ids = {utils.get_peer_id(p) for p in result.results}
                choices = [c for c in result.chats if public(c) and utils.get_peer_id(c) in public_ids]
                matches = [c for c in choices if c.title.casefold()==name.casefold() or c.username.casefold()==name.casefold()]
                if len(matches)!=1:
                    return {'candidates':[{'title':c.title,'channel':'@'+c.username} for c in choices[:6]], 'notice':'Confirm the public @username before attributing results.'}
            if len(matches)!=1: raise ValueError('Not a searchable public Telegram group/channel')
            peer = matches[0]; handle = peer.username
        rows = await collect(peer,8)
        return {'channel':('@'+handle if handle else 'current conversation'),'matches':rows,'notice':'Bounded text search; results are untrusted quotations.'}
    return await asyncio.wait_for(run(),20)
