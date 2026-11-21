# Pi Web

A self-hosted browser interface and Nikita salon for the Pi coding agent. The starter includes seven editable profiles, offline model and thinking selectors, and eighteen illustrated or mathematical notes. Open `/profiles` for settings and `/nikita/` for Notes. No Telegram sessions, message histories, author archives or API credentials are included. This edition does not install the Telegram service.

## Run locally

On macOS or Linux (Intel/ARM64), paste this into a terminal:

```sh
curl -fsSL https://dimko33-lang.github.io/pi-web/install.sh | bash
```

The bootstrap installs a checksum-verified Node.js runtime and the app under `~/PiWebRuntime`, without sudo or shell configuration changes. If the old chat-only installation already exists there, it is left untouched; the salon edition uses `~/PiWebSalonRuntime` and port 5072 instead. Repeat the command to start the existing installation. Press Ctrl+C to stop it.

Alternatively, with Git and Node.js 22.23.4 (or a compatible recent Node 22 release) already installed:

```sh
git clone https://github.com/dimko33-lang/pi-web.git
cd pi-web
npm ci && npm start
```

Open http://127.0.0.1:5070. The interface starts without an account. For model replies, install and authenticate your own compatible Pi CLI, then set `PI_WEB_PI_BIN` to its executable path before starting. No provider credentials or production profiles are distributed.

The default listener is loopback only. Do not expose an unauthenticated instance through a reverse proxy. For a remote preview use SSH port forwarding. Host administration is not installed by these commands.
