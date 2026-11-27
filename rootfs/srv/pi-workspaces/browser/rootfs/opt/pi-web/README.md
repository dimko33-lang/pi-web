# pi-web

An independent browser control panel for Pi: chat, model selection, reasoning, files, interactive cards and optional chat screenshots. It has no editor project dependency. See `docs/ARCHITECTURE.md` for ownership boundaries and `docs/DECOUPLING-AUDIT.md` for the separation audit.

## Local run

```sh
npm ci
PORT=5070 npm start
```

Open http://127.0.0.1:5070/ directly. The server binds loopback only. Installed Pi and its provider authorization are reused without copying credentials. The agent working directory defaults to this project; native Pi sessions default to `sessions/`. Web transcripts, settings and images are in `data/`. Connected application files and data are not part of the panel.

The active deployment is now on the German server under `/opt/pi-web`, running as root by explicit owner request, with a separate Pi installation at `/opt/pi-web-runtime`. Opening the private chat at `https://@@SITE_HOST@@/` requires a private access link for the first visit; it establishes a browser session and redirects to the clean root URL. Without a session, GET `/` serves only a public metadata-only landing page (HTTP 200) so cookie-less link crawlers can preview pi-web. The app HTML, assets, files and APIs remain authenticated. Telegram caches previews by URL across new messages; existing previews may require a refresh via @WebpageBot. The secret is stored in `/etc/pi-web.env` and is not part of source backups. The Moscow pi-web application, account, runtime, backups and domain proxy were removed after the migration. The local development instance remains separate.

Configuration uses `PI_WEB_*`: `PI_WEB_PI_BIN`, `PI_WEB_AGENT_ROOT`, `PI_WEB_SESSIONS_DIR`, `PI_WEB_PROXY`, `PI_WEB_PASSWORD` (or supported password/hash combination), plus `PORT` and `CHROMIUM_PATH`. The isolated `server/legacy-compat.ts` accepts previous environment names during rollout; explicit new values take precedence. Ancestor context discovery is disabled so unrelated application instructions are not loaded. Local use may share an installed CLI; Germany uses its independent Pi installation and authorization.

## Preserved

Current Chat appearance, composer, scroll/follow behavior, model and thinking pickers, reasoning display, Resume, streaming/reconnect/stop, message actions, interactive cards, KaTeX formulas and visible tool-image previews. The unused Terminal appearance and appearance picker are removed. Chat capture is always available during authenticated tool-enabled turns, with no eyes toggle or per-browser permission state.

## Removed

The editor project directory, geometry modules, shell/Skeleton and Loopform pages, scene routes, editor snapshots/restore, presence collaboration, editor demo/sandbox runner and editor browser capture. Eyes support only `target: chat` and capture the standalone root page. The brand no longer links to an editor.

## Known boundaries

The former editor navigation, visitor personas, multi-room switch, geometry help, external application windows, old project routes and duplicate message-action implementation have been removed. Existing browser preferences, environment configuration and native message-deletion markers are read only by small migration boundaries. No project source or service is loaded by those readers. pi-web owns its independent `/files/` service, described below. A multi-project registry/launcher has not been implemented yet; this cleanup establishes ownership boundaries, not a complete project manager.

All tabs still share the selected conversation. The access link protects page assets and APIs, but it does not create per-user conversation isolation. Agent tools run with the launching user's permissions; in the owner-requested German deployment that means full root access. A separate directory is not a sandbox. Do not expose the root agent without authentication or distribute the private link unintentionally.

## Files

`server/files.ts` owns authenticated `/files/` routes and private disk storage in `data/uploads/`. `public/files.html` and `file-browser.js/.css` render the existing Files iframe using the preserved fileshare layout and typography, with the shared neutral surface. The original drop zone labels, All files counter, extension badges, sizes, dates and delete crosses are retained. Upload, list, forced download and delete are supported. Deletion confirmation uses an in-page dark dialog instead of a native bright browser prompt. Duplicate names use independent UUID records; Unicode names are retained. Storage is never exposed through static serving. Downloads require the existing browser session, including copied links.

Uploads stream to disk through Multer; default limit is 1024 MB per file, configurable via `PI_WEB_UPLOAD_MAX_MB`. nginx must stream `/files/upload` without its old 64 MB request-body ceiling; the application enforces its own file limit. Failed uploads are cleaned up. There is no automatic file expiry or total-storage quota. Deleting a file breaks its old links. Files are not included in Save source archives.

The chat's existing plus/file picker uses the same upload route and passes the actual returned download URL and local filesystem path to the agent. This is a file reference, not automatic extraction of every document type. The agent uses its tools to inspect supported formats.

Check: `node tests/files.mjs` with `CHROMIUM_PATH` when needed. Tests run a disposable authenticated server/storage, cover Unicode, duplicate names, download isolation, limits, partial cleanup, symlink rejection, mobile UI and a mocked chat attachment; no paid model calls or production files.

## Small, editable source

- `public/chat.html`: markup and asset loading, not application logic.
- `public/chat.css`: layout, fonts and the single supported Chat appearance.
- `public/chat-popovers.css`: viewport anchoring for menus.
- `public/surface-colors.css`: shared panel/button color tokens.
- `public/chat.js`: application behavior, streaming and rendering orchestration.
- Existing small `chat-thinking`, `chat-images`, `chat-message-actions`, Files, cards and Save modules retain their separate responsibilities.

KaTeX retains all font families as WOFF2; duplicate TTF/WOFF fallbacks are removed for modern browsers. The initial slimming pass reduces `public` from about 2.5 MB to 1.6 MB and the source archive from about 1.86 MB to 1.25 MB, without dropping formulas/cards/fonts. This is source cleanup, not minification. Dependencies and runtimes remain separate from Save.

The browser does not reload automatically during a live response. Source changes are applied on page reload; the project is editable by the agent but does not claim an implemented hot-reload pipeline.

## Shared surface color

`public/surface-colors.css` owns the shared gray surface token `--chat-surface: #353536`, sampled from the active Safari toolbar. User bubbles in Chat appearance, composer, app popovers, Resume, reasoning cards and notices share this surface; the transcript stays black. Geometry and active-state indicators are unchanged. Native browser menus and third-party iframe contents are outside this stylesheet; the independent Files page loads the shared surface token itself. Check: `node tests/surface-colors-browser.mjs` on a running local server (mobile/desktop computed colors).

## Portable source backup

The always-visible, muted gray `Save` button in the bottom status row downloads a small source archive in one click. `server/source-archive.ts` owns source export; `public/source-save.js` mounts the persistent control before the model label and formats the downloaded filename as `pi-web-project-YYYY-MM-DD_HH-mm-ss.tar.gz` in `Europe/Moscow`. It converts the archive creation timestamp supplied by the server, independent of the browser's local time zone; custom filenames are preserved. Export is refused during an active agent turn. Temporary server archives are removed after delivery.

The archive includes maintained source, vendor assets, model allowlist, boolean mode settings, selected model, `RESTORE.md`, `start.sh` and a systemd template. It does not include history, native sessions, attachments, custom prompts/character text, credentials, Pi, Node.js, Chromium, node_modules or previous backups. Restore instructions install the omitted runtime separately and require independent model authorization. DNS/TLS configuration is not copied.

Checks: `node --import tsx tests/source-archive.mjs` verifies exclusions, extraction, clean dependency installation and server startup; `node tests/source-save-browser.mjs` verifies download and failure UI. Browser checks require the local server and Chromium. `node --import tsx tests/vision-always-on.mjs` checks actual browser capture, chat preview storage, authentication, target restriction and turn revocation without any enable step.

## Verification

With the local server running and `CHROMIUM_PATH` set if necessary:

```sh
npm test
node tests/chat-scroll-browser.mjs
node tests/chat-composer-scroll-browser.mjs
node tests/deletion-regressions.mjs
```

These cover original UI startup and menus, absence of editor routes/files, original scrolling and composer anchoring. Chat browser capture is also verified locally. Deletion regressions run an isolated server against disposable conversations: server-generated missing-key notices can be deleted/undone without editing model context, ordinary unmatched model answers remain protected, and deleting an active conversation from Resume clears its transcript and rotates the selected session even if its native file was already missing. Tests send no paid model requests. Other live provider/tool turns and every possible Resume/delete path are not certified by those checks. `node tests/files.mjs` checks the independent file service; `node tests/decoupling.mjs` verifies architecture isolation and migration compatibility.
