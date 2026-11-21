# Pi Web

A self-hosted browser interface for the Pi coding agent. This is a source preview, not the older npm package.

## Run locally

On macOS or Linux (Intel/ARM64), paste this into a terminal:

```sh
curl -fsSL https://dimko33-lang.github.io/pi-web/install.sh | bash
```

The bootstrap installs a checksum-verified Node.js runtime and the app under `~/PiWebRuntime`, without sudo or shell configuration changes. Repeat the command to start the existing installation. Press Ctrl+C to stop it.

Alternatively, with Git and Node.js 22.23.4 (or a compatible recent Node 22 release) already installed:

```sh
git clone https://github.com/dimko33-lang/pi-web.git
cd pi-web
npm ci && npm start
```

Open http://127.0.0.1:5070. The interface starts without an account. For model replies, install and authenticate your own compatible Pi CLI, then set `PI_WEB_PI_BIN` to its executable path before starting. No provider credentials or production profiles are distributed.

The default listener is loopback only. Do not expose an unauthenticated instance through a reverse proxy. For a remote preview use SSH port forwarding. Host administration is not installed by these commands.
