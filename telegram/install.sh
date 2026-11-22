#!/bin/bash
# Called by the card installer. No Telegram connection or credentials on install.
set -euo pipefail
base=$1; pi=$2; node_bin=$3
case "$base" in /*) ;; *) echo 'Expected absolute installation directory' >&2; exit 1;; esac
src="$base/app/telegram"; venv="$base/telegram-venv"
need_python(){ command -v python3 >/dev/null && python3 -c 'import ensurepip,venv,sys; assert sys.version_info >= (3,9)' >/dev/null 2>&1; }
if ! need_python; then
  if [[ $(uname -s) == Linux && $EUID == 0 ]] && command -v apt-get >/dev/null; then
    echo 'Installing Python and venv for Telegram…'; export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
    apt-get -qq update; apt-get -y -qq install python3 python3-venv
  fi
  need_python || { echo 'Telegram requires Python 3.9+ with venv.' >&2; exit 1; }
fi
if [[ ! -x $venv/bin/python ]]; then python3 -m venv "$venv"; fi
if ! cmp -s "$src/requirements.lock" "$venv/.installed-lock" || ! "$venv/bin/python" -c 'import telethon,qrcode' 2>/dev/null; then
  echo 'Installing Telegram transport…'; "$venv/bin/python" -m pip --disable-pip-version-check install --no-input -q -r "$src/requirements.lock"
  "$venv/bin/python" -c 'import telethon,qrcode'; cp "$src/requirements.lock" "$venv/.installed-lock"
fi
mkdir -p "$base/bin"; tmp=$(mktemp "$base/bin/.telegram.XXXXXX"); trap 'rm -f "$tmp"' EXIT
{
  printf '#!/bin/bash\nset -eu\nbase=%q\nexport PI_WEB_PI_BIN=%q PATH=%q:"$PATH"\n' "$base" "$pi" "$node_bin"
  cat <<'SH'
case "${1:-status}" in
  connect) "$base/telegram-venv/bin/python" "$base/app/telegram/instance.py" connect
           if [[ -d /run/systemd/system && $EUID == 0 ]]; then exec "$base/telegram-venv/bin/python" "$base/app/telegram/service.py" "$base"; fi
           printf 'Start the connected account with: %q run\n' "$base/bin/nikita-telegram";;
  start) exec "$base/telegram-venv/bin/python" "$base/app/telegram/service.py" "$base";;
  run|status) exec "$base/telegram-venv/bin/python" "$base/app/telegram/instance.py" "${1:-status}";;
  *) echo 'Usage: nikita-telegram {connect|start|run|status}' >&2; exit 2;;
esac
SH
} >"$tmp"
chmod 755 "$tmp"; mv "$tmp" "$base/bin/nikita-telegram"
printf 'Telegram installed. Connect a NEW agent account later: %q connect\n' "$base/bin/nikita-telegram"
