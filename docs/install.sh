#!/bin/bash
# Pages bootstrap for the fresh Ubuntu reference deployment. No rolling branch downloads.
set -euo pipefail
main() {
  local version=v0.14.2 sha=3197a16d8a692bbec60535652a3a3091fe6710ff2fd5618960817b592a6dc72c mode=${1:-install} tmp asset url
  case "$mode" in install|--verify-only) ;; *) printf 'Usage: bash install.sh [--verify-only]\n' >&2; return 2;; esac
  if [[ $mode == install ]]; then
    [[ $(uname -s) == Linux && $(uname -m) == x86_64 && -r /etc/os-release ]] || { echo 'A fresh Ubuntu 24.04 x86-64 host is required. Nothing installed.' >&2; return 1; }
    ( . /etc/os-release; [[ $ID == ubuntu && $VERSION_ID == 24.04 ]] ) || { echo 'Ubuntu 24.04 required; nothing installed.' >&2; return 1; }
    [[ $EUID == 0 ]] || { echo 'Run on a fresh host as root, or use: curl -fsSL https://dimko33-lang.github.io/pi-web/install.sh | sudo bash' >&2; return 1; }
  fi
  umask 077; tmp=$(mktemp -d /tmp/pi-web-release.XXXXXXXX); trap "rm -rf -- '$tmp'" EXIT
  asset="pi-web-$version.tar.gz"; url="https://github.com/dimko33-lang/pi-web/releases/download/$version/$asset"
  echo "Fetching Pi Web $version. The distribution contains the environment, not private projects."
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$url" -o "$tmp/asset"
  python3 -E -B - "$tmp" "$sha" "pi-web-$version" <<'PY'
import hashlib, pathlib, sys, tarfile
root=pathlib.Path(sys.argv[1]);asset=root/'asset';prefix=sys.argv[3]+'/'
if hashlib.sha256(asset.read_bytes()).hexdigest()!=sys.argv[2]:sys.exit('Release archive checksum mismatch; nothing installed.')
new=root/'source';new.mkdir(mode=0o700)
with tarfile.open(asset,'r:gz') as archive:
    size=0
    for member in archive:
        raw=member.name[len(prefix):];p=pathlib.PurePosixPath(raw);size+=member.size
        if not member.name.startswith(prefix) or not member.isfile() or p.is_absolute() or '..' in p.parts or str(p)!=raw or size>128*1024*1024:sys.exit('Unexpected release archive layout')
        target=new/p;target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as out,archive.extractfile(member) as content:out.write(content.read())
PY
  python3 -E -B "$tmp/source/tools/prepare.py"
  if [[ $mode == --verify-only ]]; then echo 'Pinned archive verified. Nothing installed.'; else python3 -E -B "$tmp/source/tools/ubuntu_install.py"; fi
  rm -rf -- "$tmp"; trap - EXIT
}
main "$@"
