"""Synthetic enrollment checks. No Telegram connection or credentials."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

module = Path(__file__).resolve().parents[1] / 'telegram/private_profiles.py'
sys.path.insert(0, str(module.parent))
from private_profiles import guests, private_profile_key

with tempfile.TemporaryDirectory() as tmp:
    os.environ['PI_WEB_TELEGRAM_DATA'] = tmp
    assert not guests()
    subprocess.run([sys.executable, module, '22', 'Example guest'], check=True)
    for peer, sender, key in [(11, 11, 'owner_dm'), (22, 22, 'dm_22'), (33, 33, None), (-22, 22, None), (22, 33, None)]:
        assert private_profile_key(peer, sender, 11, guests()) == key
    subprocess.run([sys.executable, module, '22'], check=True)
    assert private_profile_key(22, 22, 11, guests()) is None
print('DM admission, owner routing and revocation passed.')
