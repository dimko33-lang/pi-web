"""Admission for explicit circle requests in configured demo groups only."""
import re

_COMMAND = re.compile(r'/circle(?:[ \t\r\n]+(.*))?', re.DOTALL)
# A bare noun in ordinary conversation (a hobby club or a drawing) is not a request.
_WORD = re.compile(r'(?:(?:ника|никита)[,!:—\s]+)?(?:ответь\s+кружком(?:\s*[:,—-]\s*|\s+|$)|кружок\s*:\s*)(.*)', re.I | re.S)


_NAMES = {'никита': 'profile', 'ника': 'voice', 'ники': 'circle'}
_FIRST = re.compile(r'^\s*(никита|ника|ники)(?=$|[\s,.:;!?…—–-])', re.I)


def name_format(text):
    match = _FIRST.match(text or '')
    return _NAMES[match[1].casefold()] if match else None


def other_address_names(names):
    return tuple(name for name in names if name.casefold() not in _NAMES)


def circle_request(*, peer, demo_peers, text, incoming, is_group):
    """Return None for normal routing, '' for usage, otherwise the user's prompt.

    The caller supplies bound numeric Telegram peer IDs, never display names or
    usernames supplied in message text. Admission is independent of sender role;
    ordinary group tool permissions must still apply to the resulting turn.
    """
    if not incoming or not is_group or peer not in demo_peers or not isinstance(text, str):
        return None
    match = _COMMAND.fullmatch(text) or _WORD.fullmatch(text.strip())
    return (match.group(1) or '').strip() if match else None
