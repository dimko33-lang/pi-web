#!/usr/bin/env bash
# Offline Linux test. Supply the pinned Caddy executable; no host listener or CA changes.
set -eu
[[ $EUID == 0 && $# == 1 ]] || { echo 'Usage (Linux root): bash tests/caddy-recovery.sh PINNED_CADDY' >&2; exit 2; }
app=$(cd "$(dirname "$0")/.." && pwd); t=$(mktemp -d);trap 'rm -rf "$t"' EXIT
mkdir -p "$t/base/remote-access" "$t/base/app" "$t/home"; (cd "$app"; node -p "require('./server/export-list.json').files.join('\\n')" | tar -T - -cf -) | tar -xf - -C "$t/base/app"; cp -a "$app/node_modules" "$t/base/app/"; install -m755 "$1" "$t/base/remote-access/caddy-2.11.9"; chown -R nobody "$t"; export t
unshare --net --pid --fork --mount-proc bash -eu <<'LAB'
ip link set lo up; sysctl -qw net.ipv4.ip_unprivileged_port_start=0
runuser -u nobody -- env HOME="$t/home" PATH="$PATH" t="$t" bash -eu <<'USER'
base="$t/base"; s=$base/remote-access; export PI_WEB_PUBLIC_HOST=test.localhost PORT=15070 CURL_CA_BUNDLE="$s/data/caddy/pki/authorities/local/root.crt"; unset SSH_CONNECTION
start(){ bash "$base/app/docs/server-start.sh" "$base" linux x64 >"$t/result"; grep -q 'https://test.localhost/i#' "$t/result"; }
start; inst=$(<"$s/instance"); key=$(sha256sum "$s/access-link.json"); ap=$(pgrep -u nobody -f '^node --import tsx server/main.ts$'); proxy=$(pgrep -f "^$s/caddy-2.11.9 run "); kill "$proxy"; sleep 1;start; kill -0 "$ap";proxy=$(pgrep -f "^$s/caddy-2.11.9 run "); kill "$ap";sleep 1;start;kill -0 "$proxy";start
[[ $(<"$s/instance") == "$inst" && $(sha256sum "$s/access-link.json") == "$key" ]]; echo 'Caddy-only, app-only and healthy restart verified.'
USER
LAB
