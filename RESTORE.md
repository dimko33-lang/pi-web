# Restore a clean application from panel Save

Use only an archive you trust. Extract it into an empty private directory. From the extracted `pi-web` directory on a new supported host run:

```
PI_WEB_RESTORE_SOURCE="$PWD" bash docs/install.sh
```

This installs the saved source rather than today's GitHub main. The normal installer provisions dependencies, workers and HTTPS on a supported server. The target runtime must be new/empty. Do not extract files on top of an existing instance. You can choose a new directory with `PI_WEB_INSTALL_DIR` (nonstandard directories do not automatically provision the system science service).

Notes and the clean profile templates are included. Provider login, panel access keys, Telegram account/owner/chat bindings, live prompts, message histories, session files and user media are intentionally absent. Connect the provider and enroll a new agent after installation. This is a source restore, not an OS image or a personal-history backup. Hashes detect incomplete transfers, not the authenticity of third-party archives.
