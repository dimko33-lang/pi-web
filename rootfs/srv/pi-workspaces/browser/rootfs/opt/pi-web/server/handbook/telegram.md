# Telegram: enroll once, then choose where to answer

These commands refer to a stock installation. Use the full `bin/nikita-telegram` path printed by the installer if the base is not `~/PiWebRuntime`.

1. Run `~/PiWebRuntime/bin/nikita-telegram status`. `Connected` means a local authorization configuration exists, not proof that the network or worker is healthy. If connected, do not re-enroll just to change a chat or test speech.
2. On a new installation run `~/PiWebRuntime/bin/nikita-telegram connect`. The owner supplies their Telegram application `api_id` and `api_hash`, their own numeric owner ID, and scans the QR using the **separate account that will speak as Nikita**. Then select chats and permissions. The installer itself does not require a Telegram login. Never run two copies of one Telegram session.
3. For an already enrolled account use `nikita-telegram bind --help` with the full installed path. Bind the intended tab and actual chat ID. `--replies` grants reply permission; `--no-replies` removes it. Author collection is separate. Do not grant either just to diagnose silence. On stock systemd the enrolled worker can be started with `nikita-telegram start`; do not start a second foreground worker beside it.
4. Test from the enrolled owner's DM first. In a group, check reply permission, the profile's Replies setting and whether this message addresses Nikita. Voice format never overrides admission, mute or addressing. Private histories and authorizations do not belong in Save or this handbook.
