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
cd "$base/app"; rm -rf "$tmp"; trap - EXIT; exec node --import tsx server/main.ts
