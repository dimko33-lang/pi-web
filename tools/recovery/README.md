# Reference deployment recovery

`docs/install.sh` installs standalone Pi Web. It does **not** deploy the Telegram agent, privileged browser launcher, service isolation or auxiliary workers of a reference host. Install success or a working chat page is not a full-host recovery test.

## Private source checkpoint

On a trusted backup machine with SSH access to the reference host, from the repository root:

```bash
umask 077
ssh "$REFERENCE_HOST" python3 - < tools/recovery/reference_source.py > nikita-private-source.tar.gz &&
python3 tools/recovery/reference_source.py --verify nikita-private-source.tar.gz
```

Store the archive privately and off the source host. Do not commit it or serve it from the web panel. It contains implementation details and can still refer to production paths and chat IDs. The checksum manifest detects damaged files, not malicious replacement of the archive. Keep a SHA-256 digest separately in trusted storage.

To recover the files offline, without starting any services:

```bash
python3 tools/recovery/reference_source.py --restore-source nikita-private-source.tar.gz ./recovered-source
```

The destination must not already exist. The reader rejects links, non-regular files, unexpected path syntax, duplicate names, oversized archives and manifest mismatches. Restored source is private and is not executable by default.

## Scope and remaining deployment work

This checkpoint includes Telegram runtime and tool code, browser application sources, archive readers, UI source for the salon, the site-entry bridge, browser launcher, login helpers, history collectors and the web/image/science worker sources. It does not collect `config.py`, env files, live systemd environment directives, databases, messages, photos, login sessions, subscriptions, project directories, customer instructions or keys. It is not a complete dependency bundle. Auxiliary hosted sites are not copied.

Before deploying a clean independent instance, replace production paths, owner/group/chat bindings and service endpoints with instance settings. Supply clean starter instructions and empty indexes; build dependencies, service users, isolation, mounts, sockets and scoped privilege rules; generate new access credentials. Start Telegram only after a new account has authenticated and its identity and routing bindings have been verified. Never activate a reference Telegram session on another host.

Acceptance requires a fresh-host restore, including actual browser execution UIDs (off/on/off), save **and restore**, Telegram delivery/reply recovery, archives, reboot recovery and preservation of local settings on rerun. Source restore alone does not meet that requirement.
