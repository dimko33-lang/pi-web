# Pi Web — reference application source

Pi Web is a personal application. The running primary instance is the sole implementation reference. Version 0.14.0 installs its actual code and deployment definitions on a fresh Ubuntu Server 24.04 x86-64 host. There is no standalone Telegram transport, reimplemented reader, simplified profile UI or replacement Caddy controller in the candidate payload. The [Ubuntu installation guide](docs/ubuntu-install.md) describes the release-pinned installer, private enrollment and rollback.

**Status: clean Ubuntu installation has not yet been tested.** Local assembly and real loopback HTTP tests are not a Linux deployment test. This distribution is not a private instance backup. `rootfs/` is a source layout, sometimes containing typed instance bindings. Do not copy it over `/`, run its services directly from the checkout, or use recovery scripts from an unrelated release. No Telegram session, provider authorization, chat history, production password or personal prompt belongs here.

## Check locally

```sh
python3 -B tools/prepare.py
python3 -B tools/check.py
python3 -B tools/panel-smoke.py
python3 -B tools/test_installer.py --http
python3 -B tools/ubuntu_install.py --plan
```

The first command verifies the payload without installing anything. The second uses Python 3.9+ and Node 22 to render a disposable, synthetic filesystem and exercise reference contracts. The third installs the **panel's own locked npm dependencies in a temporary directory** and tests its real HTTP server on loopback, with a new random password and a synthetic group and DM. It does not contact Telegram or a model provider.

See [operator handoff](docs/reference-install.md) for the source map, the files provisioned externally, manual staging and tests still required before calling this a replica. One must compare what the buttons and tools actually do, not just whether the panel opens.
