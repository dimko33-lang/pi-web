# Pi Web setup and operation

See the [project overview](../README.md) for a quick start and the [reference install status](reference-install.md) for known differences from the working server.

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

On a standard root-owned systemd server, enrollment enables a dedicated unit; after reboot it resumes using the same authorization. If enrollment succeeded but service registration failed, use `nikita-telegram start` with the same full path. Other users can run `nikita-telegram run` in the foreground. In private chats, the agent answers only the configured owner. Pi uses its configured provider, the panel model when selected, and a separate Telegram conversation. Telegram does not expose the host shell or load ordinary Pi extensions. The owner’s profile can enable the image and science tools described below. Group text replies require an explicit reply binding during enrollment or `nikita-telegram bind TAB CHAT_ID --replies`; archive-only groups remain silent. Use `--no-replies` to revoke it. Each group uses its own profile and Pi history, never the owner's session or tool dispatcher. Direct routing matches the enrolled account's username, ID mention or a reply to that account. The LightCone tab uses the reference SQLite queue: new bindings start at the tip; after downtime only recent direct, still-unanswered requests are eligible for recovery (one hour, one retry). A final send with unknown delivery status is not repeated. These paths have offline restart coverage, not a live delivery certification. On Debian/Ubuntu a root install can install `python3-venv` if missing; other Linux hosts need Python 3.9+ with venv. The uninstaller removes this local Telegram login along with the installation, not the Telegram account itself.

### Send or quote a speech recording

Send a Russian Telegram voice note or a spoken Ogg/Opus, Ogg/Vorbis, MP3 or PCM WAV file. It works in allowed DMs and on addressed turns in reply-enabled groups. In a group, reply directly to the recording and mention the account in the same message, or send a voice note as a reply to Nikita where replies count as addressing. Only the current and directly quoted same-chat recording are eligible. There is no background audio scanning, music analysis or video soundtrack transcription. The Linux Telegram installer provisions checksum-pinned GigaAM v3 E2E RNNT Q8_0 (274 MB model) and transcribe.cpp 0.4.2 under the private venv (x86-64 and ARM64). A CPU-only worker processes bounded windows locally, using at most two threads. No GPU, dictation subscription or Telegram transcription API is required. Compressed audio is decoded locally; only the transcript goes to the usual reply model. The temporary audio is discarded, while ordinary dialogue/history settings still apply to the text. Timing depends on speech and CPU load. An empty recognition asks the speaker to repeat instead of asking the model to guess. Installable instances still only answer the enrolled owner in private chats; the reference also supports admitted guests.

### Ask for one spoken reply

In a permitted DM or reply-enabled group, any participant whose turn is admitted can start a new text or voice note with `Поговори со мной` (optionally `Никита, поговори со мной`) and optionally add a topic. Nikita sends one short reply as a Telegram voice note rather than an audio document. The next turn is text by default. In groups the usual addressing rules still apply: mention her in the message or, where replies count, reply directly to her with a voice note. Only the current message or its own transcript can request speech; a forwarded or quoted phrase does not switch delivery. This grants no new chat access. Photos, code blocks, long replies and local synthesis failures keep ordinary delivery. Speech is generated locally with [Piper](https://github.com/rhasspy/piper) and the Russian [Irina medium model](https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU/irina/medium), fetched directly from upstream by the Linux installer; speech assets and temporary audio are not included in Save. No cloud TTS credentials or additional Telegram account.

### Read an attached animation or short video

In the enrolled owner DM or an addressed turn in a reply-enabled group, attach a GIF, MP4 (including Telegram animations), WebM or MOV, or reply to the attachment in the same chat. Pi receives up to six silent samples in order as one image, using the selected model. This requires image input, not image generation. Incoming supported Telegram files may be up to 4 GiB, subject to available disk and Telegram access. One temporary download at a time must leave at least 1 GiB free. The visual decoder seeks into a private file instead of buffering the movie; there is no fixed clip-duration cutoff. Decoding time and image dimensions remain bounded. Larger JPEG, PNG and WebP inputs become a compact image for inference or editing. For supported UTF-8 text documents the model receives at most the first 120,000 characters with an explicit truncation notice. The file-size limit is not a guarantee that a model can process every frame, format or document. No audio transcription, streaming links, automatic reading of a group's media feed or alternate provider. Temporary samples are removed after the turn; ordinary Pi conversation-history settings still apply.

### Inspect one owner-DM request

In the authenticated panel, open `My DM`. Turn off Tools, Memory and Response style for that profile. Under `Request JSON`, select `Capture next ok`, then send a new plain `ok` in the owner DM (not a reply, forward or caption). The inspector shows the JSON body at the provider request hook, not proof of delivery. It does not collect HTTP headers or watch other chats. Anyone with panel access can read the body until you select `Clear` or the ten-minute capture expires. Restore your usual profile settings after the test.

## Browser chat instruction buttons

Open the `+` menu in the web chat. A short click or tap on `custom` or `character` pauses or resumes the saved text. A lit button means nonempty text is enabled for new turns. Hold the button for about half a second (or focus it and press F2) to edit, then choose Apply. Editing a paused instruction does not turn it back on. `system` still controls the same character switch; it does not toggle Custom. Telegram profiles are separate.

## Browser Root switch (standard root-owned Linux install)

Root starts off on each controller launch. Ordinary browser turns run as the dedicated `pi-web-workspace` UID with no supplementary groups, no added privileges, a private process tree and a persistent `/workspace`. They cannot read the host's `/root`, Telegram state, panel access file or service sockets. Only the selected model's credential is resolved by the original Pi login; the workspace cannot edit the controller's provider store. A switch transition checks the effective UID before acknowledging it. Red means host administration is enabled for subsequent browser turns. A second click returns future turns to workspace permissions; switching off does not undo changes previously made as root. Active turns block switching. The controller itself still runs as root in this installation layout. Anyone with the full shared panel link is an administrator. Do not publish the link.

This mode requires the bundled Pi CLI in the default `/root/PiWebRuntime` server installation. The reference host's existing launcher remains separate. A root-owned Linux process without either privilege boundary refuses browser model execution rather than silently inheriting UID 0. Uninstallation leaves the dedicated workspace and its files under `/var/lib/pi-web-workspace` intact.

## Scientific computation and images

On a fresh Debian/Ubuntu systemd server with the default root install, the same card command installs Podman, builds the pinned scientific Python image and enables `pi-web-science.service`. The initial download/build takes longer than a web-only install. No subscription is used for computation. Jobs run as UID 65534 in disposable, offline, read-only containers with bounded work storage, CPU, memory and time. No Python fallback runs on the host. On other installations the text/image functions remain available; science requires this Linux broker. The uninstaller removes the managed broker and its image tags, not Podman or unrelated containers.

Use ordinary requests in the browser or the connected owner's Telegram DM, or `/science print(2 ** 32)` and `/image A watercolor owl` for explicit tool selection. In Telegram, an image request can use an attached photo or a photo in a direct same-chat reply as its edit source. The selected provider must support the requested operation. The image adapter runs on demand with Pi's credential store (not a second copy of its refresh token). It uses the selected provider's image catalog, or the Codex image endpoint for a connected `openai-codex` OAuth account. Provider subscriptions and quotas vary; a text-only provider does not gain image access, and there is no automatic switch to another billing provider. Fresh web sessions follow a provider/model explicitly selected in the native Pi settings unless a panel model override is saved. No credentials, user images, messages or subscriptions are distributed.

## Salon and author archives

The Telegram service also collects history on its existing connection. During enrollment you can choose groups for the salon tabs directly from your account's dialog list. No group is guessed from its name. The owner DM tab is bound automatically. Salon tabs collect **only outgoing text/captions and photos** in the selected chats. The LightCone tab optionally also collects participants' text in a separate authenticated author reader (`/go/lightcone`). This requires an explicit opt-in, and never includes other chats. An empty installation contains no Telegram history.

You can also bind a tab later, e.g. `~/PiWebRuntime/bin/nikita-telegram bind lake -1001234567890` (replace the example ID). Use `bind lightcone CHAT_ID --authors` to opt in to the author reader. New bindings are picked up within about three minutes without restarting Telegram. A new binding starts at its current Telegram tip. After initialization, events wake the collector; a three-minute fallback catches missed updates. The checkpoint advances only after archive files have been written, and replay deduplicates entries. Private data lives under `telegram-state/`, never under `public/`. Source Save does not export conversations or images. This is not a Debri history importer or a guest-DM collector.

## Panel Save and clean restore

Save exports the reviewed application file list, including the 18 bundled Notes, worker sources and clean templates. Extra files in a live tree are never traversed, and changed seed content requires review. To restore a trusted unpacked Save onto a fresh host, use the command in its `RESTORE.md`. This reinstalls the saved application, not a GitHub update or a copy of a Telegram account. Maintainers: after staging new distribution files, regenerate `server/export-list.json` with `node tools/export-list.mjs` and run `node --import tsx tests/source-restore.mjs`.

## Remove the default Linux test installation

Run `curl -fsSL https://dimko33-lang.github.io/pi-web/uninstall.sh | bash` as the same user on the server. This stops private runtime processes and deletes `~/PiWebRuntime`, including its chats, settings, access tickets and HTTPS files. It removes its private Pi CLI and matching launcher links, but keeps existing Pi installations and `~/.pi` (including your Pi credentials). It does not change nginx or other installation directories. If you manually stopped nginx for your test, restart it separately when you want it back.

## Same command over SSH

On a fresh public IPv4 server the same command prepares HTTPS with Caddy, checks that `/profiles` requires authentication through the public URL, then prints a reusable panel link with no expiry. Use the same link on multiple devices. Anyone with the full link has the same panel access, not a separate account. Repeating the command prints the same link while the host and installation remain unchanged. To invalidate the link for future sign-ins, remove `remote-access/access-link.json` from the installation and rerun the launcher; this does not revoke existing browser sessions. The browser panel and Caddy stay running after logout; unlike the enrolled Telegram service, they are not registered to start after reboot. After a reboot repeat the command. Local mode does not download Caddy or publish anything.

Server mode needs a publicly routable address, DNS, and free ports 80 and 443 that the installer user can bind and the firewall permits. It uses the server address from SSH and sslip.io wildcard DNS by default. Set `PI_WEB_PUBLIC_HOST` to use your own DNS name (required for NAT/IPv6). Existing web servers are never reconfigured. TLS and application logs are under `remote-access/` inside the installation directory. Share the link only with people you intend to give owner access. On the standard Linux root install that includes the ability to enable host administration.
