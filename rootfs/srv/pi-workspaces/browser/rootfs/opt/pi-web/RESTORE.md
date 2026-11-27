# Restore pi-web on a new Linux server

This is a portable source backup, not a machine image. It contains the chat application, local vendor assets (including formula fonts), model allowlist and basic mode/model settings. It excludes conversations, sessions, uploaded images, browser grants, custom prompt/character text, passwords, API keys, OAuth authorization, Pi, Node.js, Chromium, node_modules, logs and previous backups. Public UI preferences stored in a browser are not included.

## 1. Prerequisites

Install Node.js 22.19+ with npm, tar, and nginx if a public domain is required. Use a dedicated Linux user without sudo for the application. The following assumes user `pi-web` with home `/home/pi-web`.

As the server administrator:

```sh
useradd --create-home --shell /bin/bash pi-web
chmod 700 /home/pi-web
# Copy your pi-web-*.tar.gz archive into /home/pi-web first.
chown pi-web:pi-web /home/pi-web/pi-web-*.tar.gz
```

## 2. Restore source and install runtime

Run as `pi-web` (not root):

```sh
cd /home/pi-web
tar xzf pi-web-YYYY-MM-DD*.tar.gz
cd pi-web
npm ci --omit=dev
npm install --prefix "$HOME/pi-runtime" --save-exact @earendil-works/pi-coding-agent@1.5.0 --no-audit --no-fund
node node_modules/playwright-core/cli.js install chromium
```

If Chromium reports missing OS libraries, the administrator can run `node /home/pi-web/pi-web/node_modules/playwright-core/cli.js install-deps chromium`. Installing the browser itself must remain under the application user so its cache belongs to that user.

## 3. Authorize models independently

Run `$HOME/pi-runtime/node_modules/.bin/pi`, then use `/login` to sign in to OpenAI or configure the DeepSeek API key. A remote OAuth login may require forwarding port 1455 over SSH or pasting the final redirect URL into the CLI. Do not copy OAuth credentials from another installation.

## 4. Start

```sh
cd /home/pi-web/pi-web
sh start.sh
```

The app listens on `127.0.0.1:5070`. For private testing, forward it over SSH: `ssh -L 5070:127.0.0.1:5070 user@server`, then visit http://127.0.0.1:5070/ on your computer. A different browser-facing port must also be allowed in `PI_WEB_ALLOWED_HOSTS`.

For boot startup, an administrator may adapt `deploy/pi-web.service` and enable it with systemd. This template is for this restored directory, not the original deployment path.

## 5. Optional domain

Point DNS at the new server; configure nginx to proxy to `http://127.0.0.1:5070`, preserve Host, set X-Forwarded-Proto, disable proxy buffering and use long read timeouts for streaming. Set `PI_WEB_ALLOWED_HOSTS=your-domain.example` on the application service, then configure a valid HTTPS certificate. Domain, certificate and access control are intentionally not transplanted from the old machine.

The integrated file service stores uploads in `data/uploads/`, which is excluded from this source archive. The default file limit is 1024 MB (`PI_WEB_UPLOAD_MAX_MB`). For nginx, use an exact `/files/upload` location with the same proxy headers, `proxy_request_buffering off` and `client_max_body_size 0`; the application then enforces the upload limit while streaming to disk. Other locations can retain a smaller request-body limit. File links require the same authenticated session as the chat.

The agent can execute commands as its OS user. Choose access control before exposing the service: an open domain exposes subscription usage and agent commands to visitors. All tabs share one selected conversation; this archive does not add multi-user isolation.
