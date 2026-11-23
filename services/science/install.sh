#!/bin/bash
# Install a fixed, private science broker. No host execution fallback.
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd -P)
unit=/etc/systemd/system/pi-web-science.service
state=/var/lib/pi-web-science
lib=/usr/local/lib/pi-web-science
[[ $(uname -s) == Linux && $EUID == 0 && -d /run/systemd/system ]] || { echo 'Science service needs a root-installed Linux/systemd host.' >&2; exit 1; }
for p in "$unit" "$state" "$lib"; do [[ ! -L $p ]] || { echo 'Refusing symlinked science installation.' >&2; exit 1; }; done
if [[ -e $unit || -e $state || -e $lib ]]; then
  [[ -f $state/.pi-web-managed && $(<"$state/.pi-web-managed") == stock-v1 ]] || { echo 'Science destination already exists and is not managed by Pi Web.' >&2; exit 1; }
fi
if [[ ! -x /usr/bin/podman ]]; then
  command -v apt-get >/dev/null || { echo 'Install Podman on this Linux distribution first.' >&2; exit 1; }
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
  echo 'Installing the daemonless container runtime for scientific jobs…'
  echo 'Refreshing Linux package lists for Podman…'; apt-get update
  echo 'Installing Podman packages…'; apt-get -o DPkg::Lock::Timeout=180 -y install podman
fi
install -d -m 700 "$state" "$lib"; printf '%s\n' stock-v1 >"$state/.pi-web-managed"
version=$(cd "$src" && sha256sum Dockerfile requirements.lock | sha256sum | cut -c1-20)
tag="localhost/pi-web-science:$version"
if ! /usr/bin/podman image exists "$tag"; then
  echo 'Preparing NumPy, SciPy, SymPy and plotting tools (initial download only)…'
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; cp "$src/Dockerfile" "$src/requirements.lock" "$tmp/"
  /usr/bin/podman build --tag "$tag" "$tmp"
fi
id=$(/usr/bin/podman image inspect --format '{{.Id}}' "$tag"); id=${id#sha256:}; [[ $id =~ ^[0-9a-f]{64}$ ]]
changed=0
if [[ ! -f $state/image-id || $(<"$state/image-id") != "sha256:$id" ]] || ! cmp -s "$src/worker.py" "$lib/worker.py" || ! cmp -s "$src/pi-web-science.service" "$unit"; then changed=1; fi
printf 'sha256:%s\n' "$id" >"$state/image-id.new"; mv "$state/image-id.new" "$state/image-id"
install -m 600 "$src/worker.py" "$lib/worker.py"; install -m 644 "$src/pi-web-science.service" "$unit"
systemctl daemon-reload; systemctl enable pi-web-science.service
if [[ $changed == 1 ]]; then systemctl restart pi-web-science.service; else systemctl start pi-web-science.service; fi
for ((i=0;i<30;i++)); do [[ -S /run/pi-web-science/worker.sock ]] && break; sleep 1; done
[[ -S /run/pi-web-science/worker.sock ]] || { echo 'Science broker did not become ready; see journalctl -u pi-web-science.' >&2; exit 1; }
echo 'Scientific computation ready (isolated containers, no subscription).'
