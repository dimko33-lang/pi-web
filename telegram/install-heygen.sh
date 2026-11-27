#!/usr/bin/env bash
# Enroll a separate paid renderer; enrollment does not select it.
set -euo pipefail
umask 022
[[ $# == 3 && $EUID == 0 && -d /run/systemd/system ]] || { echo 'Usage (root): bash install-heygen.sh TELEGRAM_VENV SERVICE_USER PORTRAIT.jpg' >&2; exit 2; }
v=$(realpath -- "$1"); user=$2; photo=$3
[[ -f $v/pyvenv.cfg && $user =~ ^[a-z_][a-z0-9_-]*$ && -f $photo ]]; id "$user" >/dev/null
ident=$(printf %s "$v" | sha256sum | cut -c1-12); service=pi-web-heygen-$ident
src=$(cd -- "$(dirname -- "$0")" && pwd); dest=/opt/$service; secret=/etc/pi-web-speech/$ident; units=/etc/systemd/system
for p in /etc/pi-web-speech "$secret"; do [[ -d $p && ! -L $p && $(stat -c %u "$p") == 0 && -z $(find "$p" -maxdepth 0 -perm /022 -print) ]]; done
[[ -f $secret/enabled && -S /run/pi-web-gacrux-$ident.sock ]]
for p in "$dest" "$units/$service.socket" "$units/$service@.service" "$secret/heygen-key" "$secret/heygen-portrait.jpg"; do [[ ! -e $p && ! -L $p ]] || { echo "Refusing to replace $p" >&2; exit 1; }; done
[[ -x /usr/bin/ffmpeg ]] || { echo 'Install ffmpeg (including libx264) first.' >&2; exit 1; }
mkdir -m755 "$dest"
cleanup(){ systemctl disable --now "$service.socket" >/dev/null 2>&1 || :; rm -rf -- "$dest"; rm -f -- "$secret/heygen-key" "$secret/heygen-portrait.jpg" "$units/$service.socket" "$units/$service@.service"; systemctl daemon-reload; }
trap cleanup ERR
python3.12 -m venv "$dest/venv"; "$dest/venv/bin/pip" install -r "$src/circle-requirements.lock"
install -m644 "$src"/{heygen_render,circle_media,circle_match}.py "$dest/"
IFS= read -rs -p 'Prepaid HeyGen API key (auto reload must be off): ' key; echo; [[ -n $key ]]; (umask 077; printf %s "$key" > "$secret/heygen-key"); unset key
install -m600 -- "$photo" "$secret/heygen-portrait.jpg"
cat > "$units/$service.socket" <<EOF
# Pi Web managed HeyGen broker: $ident
[Unit]
Description=Pi Web prepaid HeyGen circle socket
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
# Pi Web managed HeyGen broker: $ident
[Service]
DynamicUser=yes
StateDirectory=$service
StateDirectoryMode=0700
LoadCredential=heygen-key:$secret/heygen-key
LoadCredential=portrait.jpg:$secret/heygen-portrait.jpg
ExecStart=$dest/venv/bin/python -B $dest/heygen_render.py
Environment=CIRCLE_FFMPEG=/usr/bin/ffmpeg
StandardInput=socket
StandardOutput=socket
StandardError=journal
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
RuntimeMaxSec=915
UMask=0077
EOF
systemctl daemon-reload; systemctl enable --now "$service.socket"; test -S "/run/$service.sock"
trap - ERR
printf 'Enrolled, not selected. To opt into paid circles: printf "heygen\\n" > %s/circle-provider\n' "$secret"
