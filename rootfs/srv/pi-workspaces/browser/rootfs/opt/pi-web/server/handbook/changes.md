# Maintain the project, not a copy of someone's disk

For authorized upstream work, not routine administration of someone else's installation. A local setting change needs no public release.

1. Reproduce the requested behavior on the designated reference instance. Record the baseline and keep private rollback copies of only the files being changed. Use fixtures where possible; do not read unrelated conversations or send as the owner.
2. Bring the reviewed source change to the maintainer checkout. Account separately for reference-only service users, paths, credentials and web branding. Do not copy a live data directory as a shortcut to parity.
3. Inspect the diff and stage explicit files. Keep secrets, session files, owner links and private prompts out of Git and release assets. Run relevant behavior tests, and check that the source Save contains only the intended files.
4. Publish reviewed code to `dimko33-lang/pi-web`, `main`, and the numbered release with its archive and SHA-256. The install card selects a tagged asset, not moving `main`. Verify the published download, a clean installation of the changed component and its behavior; distinguish fixture tests from a real Telegram delivery. Never assume pushing a release upgraded existing servers.

See `docs/reference-install.md` in the installed app for the broader workflow and known portability boundaries. No local Mac path, production login or deployment authority is implied by this document.
