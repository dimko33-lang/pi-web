# Optional prepaid video notes

Anam remains the default. `Никита`, `Ника`, and `Ники` keep their existing meanings. Only a group already bound for replies and circles can request a video note. Selecting HeyGen sends that group's spoken reply and the enrolled portrait to HeyGen. Every participant allowed to request a circle can incur charges. The provider wallet is the spending limit; use a separate prepaid workspace, disable auto-reload, and do not enroll an unsuitable group.

On Linux/systemd, enroll Gacrux as usual. Install Python 3.12 with venv and `/usr/bin/ffmpeg` with libx264. Supply a JPEG you have permission to animate, a prepaid HeyGen API key with account read and video write, the actual Telegram venv and worker user. Run as root from trusted release source:

```
bash telegram/install-heygen.sh /absolute/path/to/telegram-venv SERVICE_USER /private/portrait.jpg
```

Enrollment installs a private per-instance socket and separate locked Python environment; it does not change the selected provider. To select HeyGen, run the exact selector command printed by the installer. To revert, remove that `circle-provider` file (or write `anam`); enroll Anam before switching back. Changes affect the next request, not an in-flight job. Neither keys, receipts nor portraits belong in Save or Git.

The worker accepts one group message at a time, 1–30 seconds of speech. It checks the prepaid USD wallet before submission (cost estimate $0.10/second for standard Avatar 6 at 1080p; verify current vendor prices). It records a one-attempt marker keyed by peer and source ID and polls the original job; there is no automatic paid retry or fallback to a second video provider. On failure inspect HeyGen's dashboard before requesting another video. A fresh message is a new request. The output is checked against both ends of the original speech and packed for native round video. A completed paid job may still fail validation or Telegram delivery.
