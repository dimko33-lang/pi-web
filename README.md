# Pi Web

A self-hosted browser interface and Nikita salon for the Pi coding agent. The starter includes seven editable profiles, offline model and thinking selectors, and eighteen illustrated or mathematical notes. Open `/profiles` for settings and `/nikita/` for Notes. No Telegram sessions, message histories, author archives or API credentials are included. Fresh Linux server installations include the Telegram owner-DM transport. It stays offline until you explicitly connect a new agent account. It is not the complete reference deployment: group reply routing/recovery, privileged browser execution and image/science workers are not installed by this transport.

## Run locally

On macOS or Linux (Intel/ARM64), paste this into a terminal:

```sh
curl -fsSL https://dimko33-lang.github.io/pi-web/install.sh | bash
```

The bootstrap installs a checksum-verified Node.js runtime and the app under `~/PiWebRuntime`, without sudo or shell configuration changes. It reuses your Pi CLI or installs the official npm package privately. No provider key, subscription or confirmation is needed during installation. For model replies, start `pi` as the same user and configure your provider in the standard terminal interface. If your PATH has no writable user bin directory, use the terminal command printed by the installer. If the old chat-only installation already exists there, it is left untouched; the salon edition uses `~/PiWebSalonRuntime` and port 5072 instead. On a local Mac the panel opens automatically. Local mode stays in the foreground; press Ctrl+C to stop it. Over SSH, see the server mode below.

Alternatively, with Git and Node.js 22.23.4 (or a compatible recent Node 22 release) already installed:

```sh
git clone https://github.com/dimko33-lang/pi-web.git
cd pi-web
npm ci && npm start
```

Open http://127.0.0.1:5070. The interface starts without an account. For model replies, install and authenticate your own compatible Pi CLI, then set `PI_WEB_PI_BIN` to its executable path before starting. No provider credentials or production profiles are distributed.

## Connect the installed Telegram transport (Linux)

Use the `nikita-telegram connect` command with the full path printed by the installer. Enter your Telegram application API ID/hash, your personal numeric owner ID, then scan the login QR with the **separate agent account**. Nothing is requested during the web installation. Each installation creates fresh private authorization under its own `telegram-state/`. Never copy that directory to a second running instance. Check `~/PiWebRuntime/bin/nikita-telegram status` without connecting to Telegram.

On a standard root-owned systemd server, enrollment enables a dedicated unit; after reboot it resumes using the same authorization. If enrollment succeeded but service registration failed, use `nikita-telegram start` with the same full path. Other users can run `nikita-telegram run` in the foreground. Only incoming private text messages from the configured owner are answered. Pi uses its configured provider, the panel model when selected, and a separate Telegram conversation. Host tools and extensions are disabled on this transport. Groups and other users do not trigger replies. On Debian/Ubuntu a root install can install `python3-venv` if missing; other Linux hosts need Python 3.9+ with venv. The uninstaller removes this local Telegram login along with the installation, not the Telegram account itself.

## Salon and author archives

The Telegram service also collects history on its existing connection. During enrollment you can choose groups for the salon tabs directly from your account's dialog list. No group is guessed from its name. The owner DM tab is bound automatically. Salon tabs collect **only outgoing text/captions and photos** in the selected chats. The LightCone tab optionally also collects participants' text in a separate authenticated author reader (`/go/lightcone`). This requires an explicit opt-in, and never includes other chats. An empty installation contains no Telegram history.

You can also bind a tab later, e.g. `~/PiWebRuntime/bin/nikita-telegram bind lake -1001234567890` (replace the example ID). Use `bind lightcone CHAT_ID --authors` to opt in to the author reader. New bindings are picked up within about three minutes without restarting Telegram. A new binding starts at its current Telegram tip. After initialization, events wake the collector; a three-minute fallback catches missed updates. The checkpoint advances only after archive files have been written, and replay deduplicates entries. Private data lives under `telegram-state/`, never under `public/`. Source Save does not export conversations or images. This is not a Debri history importer or a guest-DM collector.

## Remove the default Linux test installation

Run `curl -fsSL https://dimko33-lang.github.io/pi-web/uninstall.sh | bash` as the same user on the server. This stops private runtime processes and deletes `~/PiWebRuntime`, including its chats, settings, access tickets and HTTPS files. It removes its private Pi CLI and matching launcher links, but keeps existing Pi installations and `~/.pi` (including your Pi credentials). It does not change nginx or other installation directories. If you manually stopped nginx for your test, restart it separately when you want it back.

## Same command over SSH

On a fresh public IPv4 server the same command prepares HTTPS with Caddy, checks that `/profiles` requires authentication through the public URL, then prints a reusable panel link with no expiry. Use the same link on multiple devices. Anyone with the full link has the same panel access, not a separate account. Repeating the command prints the same link while the host and installation remain unchanged. To invalidate the link for future sign-ins, remove `remote-access/access-link.json` from the installation and rerun the launcher; this does not revoke existing browser sessions. The processes stay running after logout; they are not registered to start after reboot. After a reboot repeat the command. Local mode does not download Caddy or publish anything.

Server mode needs a publicly routable address, DNS, and free ports 80 and 443 that the installer user can bind and the firewall permits. It uses the server address from SSH and sslip.io wildcard DNS by default. Set `PI_WEB_PUBLIC_HOST` to use your own DNS name (required for NAT/IPv6). Existing web servers are never reconfigured. TLS and application logs are under `remote-access/` inside the installation directory. Do not share the private link. Host administration is not installed by these commands.
