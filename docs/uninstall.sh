#!/bin/bash
# Remove only the server install made in this user's default PiWebRuntime directory.
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'This command is for the Linux server. Nothing removed.' >&2; exit 1; }
exec python3 - <<'PY'
import fcntl, hashlib, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

home = Path.home().resolve(strict=True)
base = home / 'PiWebRuntime'
app = base / 'app'
state = base / 'remote-access'

def stop(message):
    sys.exit(message)

if base.is_symlink():
    stop('Refusing to remove a symlinked installation.')
if not base.exists():
    print('Pi Web is already absent from', base)
    sys.exit(0)
if not base.is_dir() or app.is_symlink() or state.is_symlink() or not (app / 'starter/catalog.json').is_file() or not (app / 'server/main.ts').is_file():
    stop(f'Not a recognized Pi Web salon installation: {base}. Nothing removed.')
if base.stat().st_uid != os.getuid():
    stop('Run as the user who installed Pi Web.')
for line in Path('/proc/self/mountinfo').read_text().splitlines():
    mount = Path(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), line.split()[4]))
    if mount == base or base in mount.parents:
        stop(f'Refusing to delete a mounted directory: {mount}')
if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
    stop('This server uninstaller needs Python 3.9+ and Linux pidfds.')

def processes():
    for proc in Path('/proc').glob('[0-9]*'):
        fd = None
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            fd = os.pidfd_open(int(proc.name))
            exe = Path(os.readlink(proc / 'exe').removesuffix(' (deleted)'))
            # The installer supplies private binaries. Never select by port or process name alone.
            if base not in exe.parents:
                continue
            yield fd, exe.name
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        finally:
            if fd is not None:
                os.close(fd)

# A connected Telegram worker uses the system Python, not the private Node binary.
unit_name = 'nikita-telegram-' + hashlib.sha256(os.fsencode(base)).hexdigest()[:12] + '.service'
unit = Path('/etc/systemd/system') / unit_name
if unit.exists() or unit.is_symlink():
    if unit.is_symlink() or not unit.read_text().startswith(f'# Pi Web managed instance: {base}\n') or os.getuid() != 0:
        stop('Unexpected Telegram unit. Nothing removed.')
    subprocess.run(['systemctl','disable','--now',unit_name], check=True)
    unit.unlink(); subprocess.run(['systemctl','daemon-reload'], check=True)
lock = base / 'telegram-state' / 'instance.lock'
if lock.exists():
    if lock.is_symlink() or lock.parent.is_symlink(): stop('Unexpected Telegram state link.')
    guard = lock.open('a')
    try: fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: stop('Stop the foreground Telegram process before uninstalling.')

# The dedicated science broker belongs only to the standard root installation.
science = Path('/var/lib/pi-web-science')
science_unit = Path('/etc/systemd/system/pi-web-science.service')
if base == Path('/root/PiWebRuntime') and science_unit.exists():
    if science_unit.is_symlink() or science.is_symlink() or (science/'.pi-web-managed').read_text().strip() != 'stock-v1' or 'ExecStart=/usr/bin/python3 -I /usr/local/lib/pi-web-science/worker.py' not in science_unit.read_text().splitlines():
        stop('Unrecognized science service; nothing removed from it.')
    subprocess.run(['systemctl','disable','--now',science_unit.name],check=True)
    engine = '/usr/bin/podman'
    if Path(engine).is_file():
        ids=subprocess.check_output([engine,'ps','-aq','--filter','label=io.pi-web.stock.science=1'],text=True).split()
        if ids: subprocess.run([engine,'rm','-f',*ids],check=True)
        tags=subprocess.check_output([engine,'images','--format','{{.Repository}}:{{.Tag}}'],text=True).splitlines()
        for tag in tags:
            if re.fullmatch(r'localhost/pi-web-science:[0-9a-f]{20}',tag): subprocess.run([engine,'rmi',tag],check=False)
    science_unit.unlink(); subprocess.run(['systemctl','daemon-reload'],check=True)
    for p in (Path('/usr/local/lib/pi-web-science/worker.py'),science/'image-id',science/'.pi-web-managed'): p.unlink(missing_ok=True)
    for p in (Path('/usr/local/lib/pi-web-science'),science):
        if p.is_dir() and not any(p.iterdir()): p.rmdir()

for fd, name in processes():
    try:
        signal.pidfd_send_signal(fd, signal.SIGTERM)
        print('Stopping', name)
    except ProcessLookupError:
        pass
for _ in range(60):
    if not list(processes()):
        break
    time.sleep(0.15)
else:
    stop('A runtime process is still active. Installation files were not removed.')
# Remove only exact symlinks created for this runtime, never an external Pi or ~/.pi.
for directory in (home / '.local/bin', home / 'bin', Path('/usr/local/bin')):
    link = directory / 'pi'
    if link.is_symlink() and os.readlink(link) == str(base / 'bin/pi'):
        link.unlink()
shutil.rmtree(base)
print(f'Removed Pi Web, local data and access links from {base}.')
PY
