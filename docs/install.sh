#!/bin/bash
# User-local Pi Web installation. No sudo, shell profile edits or provider login.
set -euo pipefail
base=${PI_WEB_INSTALL_DIR:-"$HOME/PiWebRuntime"}
# Keep the legacy chat (including local history) untouched when installing the salon edition.
if [ -z "${PI_WEB_INSTALL_DIR:-}" ] && [ -d "$base/app" ] && [ ! -f "$base/app/starter/catalog.json" ]; then
  echo 'Keeping your existing chat. Installing the salon edition alongside it.'
  base="$HOME/PiWebSalonRuntime"; export PORT="${PORT:-5072}"
fi
version=22.23.4
case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) echo 'Supported: macOS and Linux.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) echo 'Unsupported processor.' >&2; exit 1;; esac
mkdir -p "$base"; tmp=$(mktemp -d "$base/.install.XXXXXX"); trap 'rm -rf "$tmp"' EXIT
fetch(){ curl -fsSL --retry 2 "$1" -o "$2"; }
# Reuse the private runtime on later launches. Never depend on a terminal's PATH for npm.
node_dir="$base/node-v$version-$os-$arch"
if [ ! -x "$node_dir/bin/node" ]; then
  file="node-v$version-$os-$arch.tar.gz"; dist="https://nodejs.org/dist/v$version"; echo "Downloading Node.js $version for ${os}/${arch}..."
  fetch "$dist/$file" "$tmp/$file"; fetch "$dist/SHASUMS256.txt" "$tmp/sums"
  (cd "$tmp"; awk -v name="$file" '$2==name {print; found=1} END {if(!found) exit 1}' sums >check; if command -v shasum >/dev/null; then shasum -a 256 -c check; else sha256sum -c check; fi)
  tar -xzf "$tmp/$file" -C "$tmp"; mv "$tmp/node-v$version-$os-$arch" "$node_dir"
fi
export PATH="$node_dir/bin:$PATH"
if [ ! -d "$base/app" ]; then
  echo 'Downloading Pi Web...'; fetch https://codeload.github.com/dimko33-lang/pi-web/tar.gz/refs/heads/main "$tmp/app.tar.gz"; mkdir "$tmp/app"; tar -xzf "$tmp/app.tar.gz" -C "$tmp/app" --strip-components=1
  (cd "$tmp/app"; npm ci --no-audit --no-fund); mv "$tmp/app" "$base/app"
fi
# Upgrade only the exact previously published entrypoint. Never replace user code or data.
sha(){ node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
if [ "$(sha "$base/app/server/main.ts")" = ac7b6642fe006652b94a50ea3a94de9c2137eed3dc56818e42d12b157f6766b6 ]; then
  fetch 'https://raw.githubusercontent.com/dimko33-lang/pi-web/main/server/main.ts' "$tmp/main.ts"
  [ "$(sha "$tmp/main.ts")" = 19ead8986a76f817e9860e2f74e8f67f8b29d4fd331c43efba4660935d1d07ae ] || { echo 'Entrypoint version mismatch; existing installation unchanged.' >&2; exit 1; }
  cp "$base/app/server/main.ts" "$base/app/server/main.ts.pre-https"; mv "$tmp/main.ts" "$base/app/server/main.ts"
fi
if [ -n "${SSH_CONNECTION:-}${PI_WEB_PUBLIC_HOST:-}" ]; then
  grep -q 'const ticketFile = process.env.PI_WEB_TICKET_FILE' "$base/app/server/main.ts" || { echo 'This installation has a different entrypoint. Install into a new PI_WEB_INSTALL_DIR; existing data has been preserved.' >&2; exit 1; }
  helper="$base/app/docs/server-start.sh"
  if [ ! -f "$helper" ]; then fetch 'https://dimko33-lang.github.io/pi-web/server-start.sh' "$tmp/server-start.sh"; helper="$tmp/server-start.sh"; fi
  [ "$(sha "$helper")" = 12828ac39ec247591a1465e1458312c6f0298a961f6c05e114ec2762e1911bb8 ] || { echo 'HTTPS launcher checksum mismatch.' >&2; exit 1; }
  bash "$helper" "$base" "$os" "$arch"; exit
fi
cd "$base/app"; rm -rf "$tmp"; trap - EXIT; export PI_WEB_OPEN_LOCAL=1; exec node --import tsx server/main.ts
