# Reference install — status on main

The running Nikita implementation is the source for `main`. Fresh installations download the versioned release archive advertised on the card, not the moving branch head. Do not reimplement its behavior against screenshots. Import reviewed source from the deployment, then adapt only machine addresses, accounts, filesystem layout and generated instance state. Keep a source-file digest comparison and document functional differences with each import.

## Keeping the running instance and new installs in sync

For a shared feature or fix, update the running instance and `main` in the same task. Verify the running behavior, not merely a file in a checkout. Push only the reviewed portable diff directly to `main` and verify the remote commit. Compare unchanged portable files against the deployed bytes; test the same behavior when paths, accounts or services must be parameterized. A change to the installer alone need not redeploy the reference instance. Pushing to GitHub is not a deployment to existing installations.

Record the reference check, the published commit and the fresh-install check separately. If either side is pending, report it explicitly rather than calling the two equivalent. Do not sync live databases, credentials, host environment files or Telegram sessions.

## Current coverage

First import: `public/conversation-profiles.{html,js,css}`, `server/conversation-profiles.ts` and `telegram/lc_recovery.py` were imported byte-for-byte before the instance-specific wiring below. The 18 indexed Notes bodies already match the reference. The portable Notes index omits the source instance's share links. No source-host account, user session, provider authorization or chat history belongs in a release.

Owner DMs now read one saved `owner_dm` profile per turn. Its Pi/Base, Character, Custom, response style, model, thinking and tool switches control inference and tool dispatch. New profile stores inherit the instance model unless explicitly saved; existing stores are not rewritten. The portable profile reference endpoint uses the installed Pi, and `/go/hub` preserves the selected salon tab. Offline checks cover profile save/isolation and CLI invocation, not delivery through a live account.

Selected group text routing and LightCone recovery now run on the enrolled connection. Offline tests simulate downtime, manual replies, an expired request and restart after provider failure. They do not certify Telegram network delivery. Panel Save can restore the reviewed code and bundled Notes to a new directory; it is not a runtime-state backup.

The default Linux installer now applies a real browser turn privilege boundary using a dedicated UID, a Bubblewrap workspace and a checked in-memory admin switch. This achieves off/on/off execution with the stock root-owned web controller, not the reference web service account layout. Test the installed worker with `tests/browser-root-live.mjs` using its offline fixture; no model subscription call is needed.

`My DM → Request JSON` now uses the reference one-use ticket/socket protocol and Pi's `before_provider_request` hook. Only a private authenticated card panel can arm it. Send a new plain `ok` from the enrolled owner with Tools, Memory and Response style off; no group or guest turn loads the hook. The request body stays in controller memory for at most ten minutes and is never part of Save. `tests/request-inspection.mjs` compares the capture to the JSON received by a loopback provider using the real installed Pi CLI, without a live Telegram login or subscription.

Still incomplete: group attachments and role-specific tools, exact message-window handling, and end-to-end boot/recovery on a blank Linux host. The card is not yet a verified replica.

Before claiming parity: verify on an empty supported Linux server using the card command, then enroll a separate account and authorize its provider. Check profile independence, actual execution UID off/on/off, group address/reply handling and missed-question recovery, empty archives before enrollment, Notes, image and science jobs, Save/restore and post-reboot operation. Repeat installation without resetting state. For subsequent reference changes import the reviewed diff rather than syncing a live workspace, home directory, unit environment or machine image to GitHub.
