"""Manage this installation's Telegram service after explicit enrollment."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys


def install(base):
    if os.getuid() != 0 or not Path('/run/systemd/system').is_dir():
        raise SystemExit('System service installation requires a Linux systemd host and root.')
    # Unit files must never point root at a launcher controlled by another user.
    paths = [base / 'bin/nikita-telegram', base / 'app/telegram/instance.py', base / 'app/telegram/telegram_blocks.py', base / 'telegram-venv', base / 'app/telegram/service.py']
    for path in paths:
        for part in (path, *path.parents):
            st = part.lstat()
            if part.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
                raise SystemExit('Refusing service launch from a non-private installation path.')
    if not (base / 'telegram-state/connection.json').is_file():
        raise SystemExit('Connect the Telegram account first.')
    if any(ch in str(base) for ch in '\n\r\t"%\\$'):
        raise SystemExit('Unsupported characters in installation path.')
    name = 'nikita-telegram-' + hashlib.sha256(os.fsencode(base)).hexdigest()[:12] + '.service'
    unit = Path('/etc/systemd/system') / name
    body = f'''# Pi Web managed instance: {base}
[Unit]
Description=Nikita owner Telegram messages
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
Environment=HOME=/root
WorkingDirectory="{base}/telegram-state"
ExecStart="{base}/bin/nikita-telegram" run
Restart=on-failure
RestartSec=15
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths="{base}/telegram-state" -/root/.pi/agent
[Install]
WantedBy=multi-user.target
'''
    if unit.exists() or unit.is_symlink():
        if unit.is_symlink() or unit.read_text() != body:
            raise SystemExit('Existing unit differs; refusing to replace it.')
    else:
        with unit.open('x') as out: out.write(body)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', name], check=True)
    print('Enabled:', name)

if __name__ == '__main__':
    install(Path(sys.argv[1]).resolve(strict=True))
