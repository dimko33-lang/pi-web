# Reference install — status on main

The running Nikita implementation is the source for `main`, which the card installer downloads on a fresh installation. Do not reimplement its behavior against screenshots. Import reviewed source from the deployment, then adapt only machine addresses, accounts, filesystem layout and generated instance state. Keep a source-file digest comparison and document functional differences with each import.

First import: `public/conversation-profiles.{html,js,css}`, `server/conversation-profiles.ts` and `telegram/lc_recovery.py` are byte-for-byte reference source. The 18 indexed Notes bodies already match the reference. The portable Notes index omits the source instance's share links. No source-host account, user session, provider authorization or chat history belongs in a release.

Not wired yet: profile-to-agent settings, the reference entry routes, installed-Pi reference lookup, owner request inspection and Telegram group handler. The queue test checks SQLite restart semantics only, not Telegram delivery. The card currently installs this partial import, not a verified replica.

Before claiming parity: verify on an empty supported Linux server using the card command, then enroll a separate account and authorize its provider. Check profile independence, actual execution UID off/on/off, group address/reply handling and missed-question recovery, empty archives before enrollment, Notes, image and science jobs, Save/restore and post-reboot operation. Repeat installation without resetting state. For subsequent reference changes import the reviewed diff rather than syncing a live workspace, home directory, unit environment or machine image to GitHub.
