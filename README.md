# Pi Web — reference application source

Pi Web is a personal application. The running primary instance is the sole implementation reference. This local candidate imports its actual code and deployment definitions. There is no standalone Telegram transport, reimplemented reader, simplified profile UI or replacement Caddy controller in the candidate payload. The retained Pages assets serve the **previous public release**; they are not the installation path for this tree.

**Status: offline source candidate, not a verified clean-host installer or a private instance backup.** `rootfs/` is a source layout, sometimes containing typed instance bindings. Do not copy it over `/`, run its services directly from the checkout, or use recovery scripts from an unrelated release. No Telegram session, provider authorization, chat history, production password or personal prompt belongs here.

## Check locally

```sh
python3 -B tools/prepare.py
python3 -B tools/check.py
python3 -B tools/panel-smoke.py
```

The first command verifies the payload without installing anything. The second uses Python 3.9+ and Node 22 to render a disposable, synthetic filesystem and exercise reference contracts. The third installs the **panel's own locked npm dependencies in a temporary directory** and tests its real HTTP server on loopback, with a new random password and a synthetic group and DM. It does not contact Telegram or a model provider.

See [operator handoff](docs/reference-install.md) for the source map, the files provisioned externally, manual staging and tests still required before calling this a replica. One must compare what the buttons and tools actually do, not just whether the panel opens.
