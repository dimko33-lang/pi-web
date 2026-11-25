"""Admission for explicit circle requests in configured demo groups only."""
import re

_COMMAND = re.compile(r'/circle(?:[ \t\r\n]+(.*))?', re.DOTALL)


def circle_request(*, peer, demo_peers, text, incoming, is_group):
    """Return None for normal routing, '' for usage, otherwise the user's prompt.

    The caller supplies bound numeric Telegram peer IDs, never display names or
    usernames supplied in message text. Admission is independent of sender role;
    ordinary group tool permissions must still apply to the resulting turn.
    """
    if not incoming or not is_group or peer not in demo_peers or not isinstance(text, str):
        return None
    match = _COMMAND.fullmatch(text)
    return (match.group(1) or '').strip() if match else None
