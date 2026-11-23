#!/bin/bash
# The standard /root install has an authenticated controller. No sudo grant for workspace tools.
set -euo pipefail
base=/root/PiWebRuntime; state=/var/lib/pi-web-workspace; user=pi-web-workspace
[[ $EUID == 0 && $(uname -s) == Linux && $1 == "$base" ]] || exit 1
[[ -x $base/pi-cli/node_modules/.bin/pi ]] || { echo 'Browser isolation requires the installer-managed Pi CLI.' >&2; exit 1; }
for prog in /usr/bin/setpriv /usr/bin/python3; do test -x "$prog" || exit 1; done
if [[ -e $state || -L $state ]] || id "$user" >/dev/null 2>&1; then
  [[ ! -L $state && -f $state/managed-v1 && ! -L $state/work && $(stat -c %u "$state") == 0 && $(cat "$state/managed-v1") == "$(id -u "$user")" ]] || { echo 'Existing workspace is not managed by Pi Web.' >&2; exit 1; }
else
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
  install -d -m 700 "$state"; id -u "$user" > "$state/managed-v1"
fi
if [[ ! -x /usr/bin/bwrap && ! -x $state/bwrap ]]; then
  # No dpkg lock or change to system packages during unattended host updates.
  echo 'Preparing browser workspace isolation…'
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  (cd "$tmp"; apt-get download bubblewrap; dpkg-deb -x ./*.deb pkg)
  install -o root -g root -m 0700 "$tmp/pkg/usr/bin/bwrap" "$state/bwrap"
fi
install -d -m 700 -o "$user" -g "$user" "$state/work"
node=$(readlink -f "$(command -v node)"); uid=$(id -u "$user"); test "$uid" != 0
actual=$(/usr/bin/python3 -I "$base/app/services/browser/workspace.py" "$node" /usr/bin/id -u)
[[ $actual == "$uid" ]] || { echo 'Workspace UID check failed.' >&2; exit 1; }
/usr/bin/python3 -I "$base/app/services/browser/workspace.py" "$node" "$base/pi-cli/node_modules/.bin/pi" --version >/dev/null
echo "Browser workspace isolation ready (Root off: UID $uid)."
