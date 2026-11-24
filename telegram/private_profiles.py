"""Private DM enrollment for standalone installations (not exported with source)."""
import argparse
import json
import os
from pathlib import Path
import tempfile


def private_profile_key(peer, sender, owner, admitted):
    if type(peer) is not int or peer <= 0 or type(sender) is not int or peer != sender:
        return None
    if peer == owner:
        return 'owner_dm'
    return f'dm_{peer}' if str(peer) in admitted else None


def directory():
    return Path(os.environ.get('PI_WEB_TELEGRAM_DATA') or Path(__file__).resolve().parents[1] / 'data')


def guests():
    try:
        return json.loads((directory() / 'individual-dms.json').read_text())
    except FileNotFoundError:
        return {}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Enroll a Telegram DM or revoke it by omitting the label. Restart the panel after editing.')
    parser.add_argument('peer', type=int); parser.add_argument('label', nargs='?'); args = parser.parse_args()
    if not 0 < args.peer < 2**53: parser.error('Expected a positive Telegram user ID')
    entries = guests(); key = str(args.peer)
    if args.label:
        entries[key] = args.label.strip()[:80]
    else:
        entries.pop(key, None)
    directory().mkdir(mode=0o700, exist_ok=True, parents=True)
    with tempfile.NamedTemporaryFile('w', dir=directory(), delete=False) as f:
        json.dump(entries, f, ensure_ascii=False)
    os.replace(f.name, directory() / 'individual-dms.json')
