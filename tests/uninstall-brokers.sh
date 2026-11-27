#!/usr/bin/env bash
# Linux root-only isolation fixture. No host units or credentials are modified.
set -euo pipefail
app=$(cd "$(dirname "$0")/.." && pwd); export app
unshare --mount --net --propagation private bash -eu <<'LAB'
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; export HOME=$t/home
for p in /etc/systemd/system /etc/pi-web-speech /opt /var/lib; do [[ -d $p ]]; mount -t tmpfs tmpfs "$p"; done
mkdir "$t/bin"; printf '#!/bin/sh\nexit 0\n' > "$t/bin/systemctl"; chmod +x "$t/bin/systemctl"; export PATH="$t/bin:/usr/bin:/bin"; base="$HOME/PiWebRuntime"; id=$(printf %s "$base/telegram-venv"|sha256sum|cut -c1-12)
for run in 1 2; do
 mkdir -p "$base/app"/{starter,server} /etc/pi-web-speech/"$id";touch "$base/app/starter/catalog.json" "$base/app/server/main.ts"; secret=/etc/pi-web-speech/$id;touch "$secret"/{google-key,enabled,worker.py,anam-key,heygen-key,heygen-portrait.jpg,circle-provider}
 for k in gacrux circle heygen; do name=pi-web-$k-$id; u=/etc/systemd/system/$name; capital=Gacrux; [[ $k != heygen ]] || capital=HeyGen; marker="# Pi Web managed $capital broker: $id"; printf '%s\nListenStream=/run/%s.sock\n' "$marker" "$name" > "$u.socket"; dest=/opt/$name
 case $k in gacrux) cmd="/usr/bin/python3 -I -B $secret/worker.py";; circle) cmd="$dest/venv/bin/python -B $dest/circle_worker.py";mkdir "$dest";; heygen) cmd="$dest/venv/bin/python -B $dest/heygen_render.py";mkdir "$dest";; esac
 printf '%s\nExecStart=%s\n' "$marker" "$cmd" > "$u@.service"; done
 touch /etc/systemd/system/pi-web-circle-other.socket
 bash "$app/docs/uninstall.sh"; [[ ! -e $base && ! -e $secret && -f /etc/systemd/system/pi-web-circle-other.socket ]]; [[ -z $(find /opt /etc/systemd/system -name "*$id*") ]]; done
LAB
