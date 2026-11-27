#!/bin/sh
set -eu
cd "$(dirname "$0")"
export PI_WEB_PI_BIN="${PI_WEB_PI_BIN:-$HOME/pi-runtime/node_modules/.bin/pi}"
export PI_WEB_AGENT_ROOT="${PI_WEB_AGENT_ROOT:-$PWD}"
export PI_WEB_SESSIONS_DIR="${PI_WEB_SESSIONS_DIR:-$PWD/sessions}"
export PORT="${PORT:-5070}"
exec npm start
