#!/usr/bin/env bash
# Run trusted release source as root on Linux, after enrolling Gacrux.
set -euo pipefail
umask 022
[[ $EUID == 0 && -d /run/systemd/system && $# == 3 ]] || { echo 'Usage (root): bash install-circle.sh TELEGRAM_VENV SERVICE_USER AVATAR_UUID' >&2; exit 2; }
v=$(realpath -- "$1"); user=$2; avatar=$3
[[ -f $v/pyvenv.cfg && $user =~ ^[a-z_][a-z0-9_-]*$ && $avatar =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]]; id "$user" >/dev/null
ident=$(printf %s "$v" | sha256sum | cut -c1-12); service=pi-web-circle-$ident
src=$(cd -- "$(dirname -- "$0")" && pwd); dest=/opt/$service; secret=/etc/pi-web-speech/$ident; units=/etc/systemd/system
[[ -f $secret/enabled && -S /run/pi-web-gacrux-$ident.sock ]] || { echo 'Enroll Gacrux first.' >&2; exit 1; }
for p in /etc/pi-web-speech "$secret"; do [[ ! -L $p && $(stat -c %u "$p") == 0 && -z $(find "$p" -maxdepth 0 -perm /022 -print) ]]; done
for p in "$dest" "$units/$service.socket" "$units/$service@.service" "$secret/anam-key"; do [[ ! -e $p && ! -L $p ]] || { echo "Refusing to replace $p" >&2; exit 1; }; done
mkdir -m755 "$dest"
cleanup() { systemctl disable --now "$service.socket" >/dev/null 2>&1 || :; rm -rf -- "$dest"; rm -f -- "$secret/anam-key" "$units/$service.socket" "$units/$service@.service"; systemctl daemon-reload; }
trap cleanup ERR
python3.12 -m venv "$dest/venv"; "$dest/venv/bin/pip" install -r "$src/circle-requirements.lock"
install -m644 "$src"/circle_{worker,render,media,match}.py "$dest/"
"$dest/venv/bin/python" -c 'from anam import AnamClient; import av, scipy; av.Codec("libx264","w")'
IFS= read -rs -p 'Anam API key: ' key; echo; [[ -n $key ]]; (umask 077; printf %s "$key" > "$secret/anam-key"); unset key
cat > "$units/$service.socket" <<EOF
[Unit]
Description=Pi Web circle socket
[Socket]
ListenStream=/run/$service.sock
Accept=yes
SocketUser=$user
SocketMode=0600
MaxConnections=1
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
EOF
cat > "$units/$service@.service" <<EOF
[Unit]
Description=Pi Web isolated circle renderer
[Service]
DynamicUser=yes
LoadCredential=anam-key:$secret/anam-key
Environment=ANAM_AVATAR_ID=$avatar
ExecStart=$dest/venv/bin/python -B $dest/circle_worker.py
StandardInput=socket
StandardOutput=socket
StandardError=journal
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
RuntimeMaxSec=100s
UMask=0077
EOF
systemctl daemon-reload; systemctl enable --now "$service.socket"; test -S "/run/$service.sock"
trap - ERR
printf 'Circle socket ready. Explicitly bind the intended group with --replies --circles.\n'
