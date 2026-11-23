"""Optional Linux/systemd enrollment. Run as root, using trusted release source. Reads key from stdin."""
import argparse
import getpass
import hashlib
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys
import tempfile


def write_atomic(path,data,mode):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        os.fchmod(f.fileno(),mode);f.write(data)
    os.replace(f.name,path)

def setup(venv,user):
    if os.geteuid()!=0 or not Path('/run/systemd/system').is_dir():raise SystemExit('Requires root and systemd')
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*',user):raise ValueError('Invalid service user')
    os.umask(0o022);pwd.getpwnam(user); venv=venv.resolve(strict=True)
    if not (venv/'pyvenv.cfg').is_file():raise ValueError('Expected the Telegram venv directory')
    ident=hashlib.sha256(os.fsencode(venv)).hexdigest()[:12];name='pi-web-gacrux-'+ident
    root=Path('/etc/pi-web-speech');root.mkdir(mode=0o755,exist_ok=True);d=root/ident;d.mkdir(mode=0o755,exist_ok=True)
    for p in (root,d):
        st=p.lstat()
        if p.is_symlink() or st.st_uid!=0 or st.st_mode&0o022:raise ValueError('Unsafe service directory')
    units=Path('/etc/systemd/system');sock=units/(name+'.socket');svc=units/(name+'@.service');marker='# Pi Web managed Gacrux broker: '+ident+'\n'
    for p in (sock,svc):
        if p.is_symlink() or (p.exists() and not p.read_text().startswith(marker)):raise ValueError('Unrecognized unit')
    key=getpass.getpass('Google AI Studio API key: ') if sys.stdin.isatty() else sys.stdin.buffer.read(513).decode().strip()
    if not re.fullmatch('[A-Za-z0-9._-]{20,512}',key):raise ValueError('Invalid key format')
    write_atomic(d/'google-key',key.encode(),0o600)
    write_atomic(d/'worker.py',Path(__file__).with_name('gacrux_worker.py').read_bytes(),0o644)
    template=f'''[Unit]
Description=Nikita Gacrux voice worker
[Service]
Type=exec
DynamicUser=yes
User=pwg{ident}
LoadCredential=google-key:{d}/google-key
ExecStart=/usr/bin/python3 -I -B {d}/worker.py
StandardInput=socket
StandardOutput=socket
StandardError=null
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RuntimeMaxSec=55
MemoryMax=160M
'''
    socket=f'''[Unit]
Description=Nikita Gacrux voice socket
[Socket]
ListenStream=/run/{name}.sock
Accept=yes
SocketUser={user}
SocketMode=0600
MaxConnections=2
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
'''
    write_atomic(sock,(marker+socket).encode(),0o644);write_atomic(svc,(marker+template).encode(),0o644)
    subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','enable','--now',sock.name],check=True)
    if not Path(f'/run/{name}.sock').is_socket():raise RuntimeError('Voice socket not ready')
    write_atomic(d/'enabled',b'Gacrux\n',0o644);print('Gacrux enabled; key stays in the broker, outside the app and Save.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--venv',type=Path,required=True);p.add_argument('--user',required=True);a=p.parse_args();setup(a.venv,a.user)
