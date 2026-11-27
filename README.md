# Pi Web — Nika environment

Install the browser panel, Telegram runtime, per-conversation settings, isolated tools, publishing and private recovery services on a new Ubuntu Server 24.04 x86-64 host. [Installation and enrollment](docs/ubuntu-install.md) · [Scope of the public release](docs/reference-install.md).

Projects and their outputs are **not** the product. The public installer creates empty writable workspaces, supplies the development and hosting tools, and waits for explicit publication. Private Save collects the actual projects and their data. Never publish a Save, enroll an existing Telegram session on two hosts, or unpack the distribution over a working server.

Offline checks (Python 3.9+, Node 22 for JavaScript checks):

```sh
python3 -B tools/prepare.py
python3 -B tools/check.py
python3 -B tools/test_projects.py
python3 -B tools/test_installer.py --http
python3 -B tools/ubuntu_install.py --plan
```

HTTP tests exercise the real panel and site-entry on loopback using synthetic credentials, without Telegram or model calls. The project test covers the package boundary, private registry and release transitions; Docker, systemd and ACME require Linux verification. See the versioned release notes for what was actually tested.
