# Pi Web

A self-hosted browser interface and Nikita salon for the Pi coding agent. The starter includes seven editable profiles, offline model and thinking selectors, and eighteen illustrated or mathematical notes. Open `/profiles` for settings and `/nikita/` for Notes. No Telegram sessions, message histories, author archives or API credentials are included. This edition does not install the Telegram service.

## Run locally

On macOS or Linux (Intel/ARM64), paste this into a terminal:

```sh
curl -fsSL https://dimko33-lang.github.io/pi-web/install.sh | bash
```

The bootstrap installs a checksum-verified Node.js runtime and the app under `~/PiWebRuntime`, without sudo or shell configuration changes. If the old chat-only installation already exists there, it is left untouched; the salon edition uses `~/PiWebSalonRuntime` and port 5072 instead. On a local Mac the panel opens automatically. Local mode stays in the foreground; press Ctrl+C to stop it. Over SSH, see the server mode below.

Alternatively, with Git and Node.js 22.23.4 (or a compatible recent Node 22 release) already installed:

```sh
git clone https://github.com/dimko33-lang/pi-web.git
cd pi-web
npm ci && npm start
```

Open http://127.0.0.1:5070. The interface starts without an account. For model replies, install and authenticate your own compatible Pi CLI, then set `PI_WEB_PI_BIN` to its executable path before starting. No provider credentials or production profiles are distributed.

## Same command over SSH

On a fresh public IPv4 server the same command prepares HTTPS with Caddy, checks that `/profiles` requires authentication through the public URL, then prints a private one-use link valid for ten minutes. Click it on your laptop. Repeat the command to get another link. The processes stay running after logout; they are not registered to start after reboot. After a reboot repeat the command. Local mode does not download Caddy or publish anything.

Server mode needs a publicly routable address, DNS, and free ports 80 and 443 that the installer user can bind and the firewall permits. It uses the server address from SSH and sslip.io wildcard DNS by default. Set `PI_WEB_PUBLIC_HOST` to use your own DNS name (required for NAT/IPv6). Existing web servers are never reconfigured. TLS and application logs are under `remote-access/` inside the installation directory. Do not share the private link. Host administration is not installed by these commands.
