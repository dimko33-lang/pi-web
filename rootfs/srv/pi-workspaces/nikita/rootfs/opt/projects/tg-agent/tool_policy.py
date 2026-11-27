"""One capability manifest for Pi registration, invocation and broker authorization.

Common capabilities never confer cross-conversation data or administration rights.
Unknown future roles inherit only the common set; existing admission gates still apply.
"""
import json
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name('tool-policy.json').read_text())
BUILTINS = frozenset(('read', 'bash', 'edit', 'write'))


def tools_for(role):
    return tuple(dict.fromkeys(POLICY['common'] + POLICY.get(role, [])))


def role_for(uid, channel, actor_id, owner_id, public_chat_id, lightcone_id, debri_ids, curvelab_id):
    if not channel:
        return 'owner' if uid == owner_id else 'guest'
    if uid in (-curvelab_id, @@LAKE_PEER@@, @@ARRI_PEER@@):  # Project groups never inherit owner tools.
        return 'public_research'
    if uid == -lightcone_id:
        return 'lightcone'
    if uid in tuple(-value for value in debri_ids):
        return 'debri'
    # Administration is never inherited by a newly authorized group.
    if uid == -public_chat_id and actor_id == owner_id:
        return 'channel_owner'
    return 'channel' if uid == -public_chat_id else 'guest'
