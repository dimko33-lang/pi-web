"""Configuration boundary for the reference client. Provision privately before enrollment."""
import json
from pathlib import Path

_settings = json.loads(Path('/etc/pi-web-instance/telegram-client.json').read_text())
API_ID = _settings['api_id']
API_HASH = _settings['api_hash']
if type(API_ID) is not int or API_ID <= 0 or not isinstance(API_HASH, str) or not API_HASH:
    raise ValueError('Private Telegram API credentials required')
SESSION = '/opt/tg-agent/account.session'
PROXY = _settings.get('proxy')
