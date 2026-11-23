#!/bin/bash
# User-local Pi Web installation. No sudo, shell profile edits or provider login.
set -euo pipefail
base=${PI_WEB_INSTALL_DIR:-"$HOME/PiWebRuntime"}
if [[ -n ${PI_WEB_RESTORE_SOURCE:-} ]]; then
  [[ -r $PI_WEB_RESTORE_SOURCE/restore-checksums.json && -r $PI_WEB_RESTORE_SOURCE/docs/restore-source.mjs ]] || { echo 'Expected an unpacked trusted panel Save.' >&2; exit 1; }
  [[ ! -e $base || ( -d $base && ! -L $base && -z $(ls -A "$base") ) ]] || { echo 'Restore requires a new empty installation directory.' >&2; exit 1; }
fi
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
# No credentials or interactive prompts. Use the same HOME for terminal and web Pi.
base=$(cd "$base" && pwd -P); node_dir="$base/node-v$version-$os-$arch"
managed="$base/pi-cli/node_modules/.bin/pi"; launcher="$base/bin/pi"
pi_bin=${PI_WEB_PI_BIN:-$(type -P pi || true)}
if [[ -z $pi_bin && -x $HOME/.pi/agent/bin/pi ]]; then pi_bin="$HOME/.pi/agent/bin/pi"; fi
if [[ -n $pi_bin && $pi_bin -ef $launcher ]]; then pi_bin=$managed; fi
# Only this immutable CLI tree is mounted into stock Linux workspaces.
if [[ $os == linux && $EUID == 0 && $base == /root/PiWebRuntime && -n ${SSH_CONNECTION:-}${PI_WEB_PUBLIC_HOST:-} ]]; then pi_bin=$managed; fi
if [[ -z $pi_bin || $pi_bin == "$managed" ]]; then
  pi_bin=$managed
  if [[ ! -x $managed ]]; then
    echo 'Installing official Pi CLI (no login required)…'
    npm install --prefix "$tmp/pi-cli" --ignore-scripts --no-audit --no-fund --no-progress --save-exact @earendil-works/pi-coding-agent@1.6.0
    "$tmp/pi-cli/node_modules/.bin/pi" --version
    [[ ! -e $base/pi-cli ]] || { echo 'Incomplete private Pi directory; leaving it untouched.' >&2; exit 1; }
    mv "$tmp/pi-cli" "$base/pi-cli"
  fi
fi
[[ -x $pi_bin ]] || { echo 'Pi executable not found; check PI_WEB_PI_BIN.' >&2; exit 1; }
export PI_WEB_PI_BIN="$pi_bin"
echo "Pi ready: $("$pi_bin" --version)"
if [[ $pi_bin == "$managed" || -z $(type -P pi || true) ]]; then
  mkdir -p "$base/bin"
  printf '#!/bin/bash\nexport PATH=%q:"$PATH"\nexec %q "$@"\n' "$node_dir/bin" "$pi_bin" > "$tmp/pi-launcher"; chmod 755 "$tmp/pi-launcher"; mv -f "$tmp/pi-launcher" "$launcher"
  # Never replace another Pi or edit shell startup files. On a fresh root SSH login,
  # /usr/local/bin is already in PATH; unprivileged installs prefer user directories.
  dirs=("$HOME/.local/bin" "$HOME/bin"); if [[ $EUID == 0 && $base == "$HOME/PiWebRuntime" ]]; then dirs=(/usr/local/bin "${dirs[@]}"); fi
  for dir in "${dirs[@]}"; do
    [[ :$PATH: == *":$dir:"* ]] || continue
    mkdir -p "$dir" 2>/dev/null || continue
    [[ $dir/pi -ef $launcher ]] && break
    [[ -w $dir && ! -e $dir/pi && ! -L $dir/pi ]] || continue
    ln -s "$launcher" "$dir/pi" && break
  done
  if ! type -P pi >/dev/null; then printf 'Terminal Pi: %q\n' "$launcher"; fi
fi
if [ ! -d "$base/app" ]; then
  if [[ -n ${PI_WEB_RESTORE_SOURCE:-} ]]; then
    echo 'Verifying and restoring the saved application...'
    node "$PI_WEB_RESTORE_SOURCE/docs/restore-source.mjs" "$PI_WEB_RESTORE_SOURCE" "$tmp/app"
  else
    echo 'Downloading Pi Web...'; fetch https://codeload.github.com/dimko33-lang/pi-web/tar.gz/refs/heads/main "$tmp/app.tar.gz"; mkdir "$tmp/app"; tar -xzf "$tmp/app.tar.gz" -C "$tmp/app" --strip-components=1
  fi
  (cd "$tmp/app"; npm ci --no-audit --no-fund); mv "$tmp/app" "$base/app"
fi
# Upgrade the previous stock salon release as a unit. Never replace edited files, settings or sessions.
sha(){ node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
case "$(sha "$base/app/server/main.ts")" in ac7b6642fe006652b94a50ea3a94de9c2137eed3dc56818e42d12b157f6766b6|19ead8986a76f817e9860e2f74e8f67f8b29d4fd331c43efba4660935d1d07ae|b2b3ae86de1b7a054bba42cb270b17301183e45330fb85298d3b8d602f638b47)
  fetch 'https://codeload.github.com/dimko33-lang/pi-web/tar.gz/edae8248ff99770d3873766f9fa3c377346077f5' "$tmp/update.tgz"
  mkdir "$tmp/update"; tar -xzf "$tmp/update.tgz" -C "$tmp/update" --strip-components=1
  while read -r known file; do
    actual=$(sha "$base/app/$file")
    [ "$actual" = "$known" ] || [ "$actual" = "$(sha "$tmp/update/$file")" ] || { echo "Local edit in $file; update stopped without overwriting it." >&2; exit 1; }
  done <<'KNOWN'
61bb8f678d9b2abbd55e9b48f8a74d5d96371a576d44781011a9aeb13dd9ed9a public/conversation-profiles.html
52c6a892b1d021e342ca4916f08e227d174dd6937ca0395da12ec0ad85e9a836 public/conversation-profiles.js
ba25154763b3f50f5259d4cc0fa1a2575300a062939c8360b7b2702c30de306f public/conversation-profiles.css
2b6c1bf29bfa15828f2a7f36a3d7db69c68fbc744f2c1892e60a16c2aa4ec27a server/agent.ts
0dd62f2073cfc1d9b186d4e6b1a579cc37f320243453972b904b44076774c3d9 starter/system.md
KNOWN
  for file in starter/system.md public/conversation-profiles.html public/conversation-profiles.js public/conversation-profiles.css server/agent.ts server/main.ts; do
    mv "$tmp/update/$file" "$base/app/$file"
  done
  echo 'Updated stock application files. Restart an already running server to load the new code.'
;; esac
if [ -n "${SSH_CONNECTION:-}${PI_WEB_PUBLIC_HOST:-}" ]; then
  if [[ $os == linux ]]; then
    if [[ -f $base/app/telegram/install.sh ]]; then
      bash "$base/app/telegram/install.sh" "$base" "$PI_WEB_PI_BIN" "$node_dir/bin"
    else
      echo 'Existing application predates Telegram support; preserving it. Fresh installations include Telegram.'
    fi
  fi
  if [[ $os == linux && $EUID == 0 && $base == /root/PiWebRuntime && -f $base/app/services/browser/install.sh ]]; then
    bash "$base/app/services/browser/install.sh" "$base" </dev/null
  fi
  if [[ $os == linux && -f $base/app/services/science/install.sh ]]; then
    if [[ $EUID == 0 && -d /run/systemd/system && $base == /root/PiWebRuntime ]]; then
      bash "$base/app/services/science/install.sh" </dev/null
    else
      echo 'Image support uses Pi credentials. The host science service is auto-installed only on a standard root/systemd Linux installation.'
    fi
  fi
  grep -q 'const ticketFile = process.env.PI_WEB_TICKET_FILE' "$base/app/server/main.ts" || { echo 'This installation has a different entrypoint. Install into a new PI_WEB_INSTALL_DIR; existing data has been preserved.' >&2; exit 1; }
  helper="$base/app/docs/server-start.sh"
  # Upgrade only the known unmodified access-link pair. Preserve profiles, keys and chats.
  if [[ -f $helper && ( $(sha "$base/app/server/main.ts"):$(sha "$helper") == 6d6eef81212ed1da395ace43976609b12b9bc1b5f37b646def14011d0ca57721:56809476d2752223e33cd1554c161493151c0b1aa11c11dfadb6261a4f311933 || $(sha "$base/app/server/main.ts"):$(sha "$helper") == 3b699caeda151994c8bbea66eea5d3738ea8ef92eea9f294221adae2cf8bcf6e:dc56783f5d248099b6de1745501d83bf07fb9768c8f04996a77cd6a6305e1e8b ) ]]; then
    for file in server/main.ts docs/server-start.sh; do fetch "https://raw.githubusercontent.com/dimko33-lang/pi-web/117cf5f/$file" "$tmp/${file##*/}"; done
    [[ $(sha "$tmp/main.ts") == 4a889bcd040d7865a15155b786a35e9499a39e91808c6ea19639f1957ef77127 && $(sha "$tmp/server-start.sh") == 0bfc64713fc75749d3ec5856a658b5e53c699e51f06f1cd9110168068b7a4c06 ]] || { echo 'Access-link update checksum mismatch.' >&2; exit 1; }
    mv "$tmp/main.ts" "$base/app/server/main.ts"; mv "$tmp/server-start.sh" "$helper"
  fi
  if [ ! -f "$helper" ] || [ "$(sha "$helper")" = 12828ac39ec247591a1465e1458312c6f0298a961f6c05e114ec2762e1911bb8 ]; then fetch 'https://dimko33-lang.github.io/pi-web/server-start.sh' "$tmp/server-start.sh"; helper="$tmp/server-start.sh"; fi
  [ "$(sha "$helper")" = 0bfc64713fc75749d3ec5856a658b5e53c699e51f06f1cd9110168068b7a4c06 ] || { echo 'HTTPS launcher checksum mismatch.' >&2; exit 1; }
  if [[ $os == linux && $EUID == 0 && $base == /root/PiWebRuntime && -f $base/app/services/browser/reload-stock.py ]]; then
    /usr/bin/python3 -I "$base/app/services/browser/reload-stock.py"
  fi
  bash "$helper" "$base" "$os" "$arch"; exit
fi
cd "$base/app"; rm -rf "$tmp"; trap - EXIT; export PI_WEB_OPEN_LOCAL=1; exec node --import tsx server/main.ts
