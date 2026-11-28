# What is in the distribution?

The distribution is the Nika environment, not a snapshot of someone's work. The implementation of the panel, entry bridge, Telegram transport, per-peer profile/memory handling, role policy, archive readers, media/PDF workers, image, speech/circles, web/science tools, private Save, nginx and systemd services comes from the running application. Ordinary turns and explicit actions have the same permission boundaries. Actual identities, personal instructions, projects, archives and credentials are instance state. See [Ubuntu installation](ubuntu-install.md) for service enrollment.

| Facility | Distributed implementation | Created on the destination or restored privately |
|---|---|---|
| Panel and Telegram | Browser and Telegram workspaces, role and approval checks, native tool registration, profiles, addressing, memory and readers | Accounts, provider keys, peer bindings, grants, personal text held for review, chats and media. Source profiles retain their independent settings and reviewed prompts, even before binding |
| Publishing and reading | Note and media rendering, protected readers, per-article share checks, two group-scoped static-site mounts | Article bodies, indexes, reader snapshots, magazines, authored pages and attachments |
| Application development | Bounded workspace volume, Node/Python toolchain image, role-gated command broker, dependency proxy, checked release/withdraw/rollback and isolated HTTP ingress | Entire working tree, lockfiles for the user's app, release slots, mutable data, snapshots and designs |
| Private Save | Authenticated nginx route to the private exporter, private root registry and SQLite staging | Instance archives, including project content that must never be fed into the public packer |

`deployment/source.json` enumerates the reviewed public payload and deployment links; `ownership.json` describes the installation permissions. `platform.json`, `dependencies.json` and `binaries.json` specify platform inputs; npm locks and separate venvs belong to the environment. `deployment/bindings.json` describes typed private inputs. Some internal profile keys retain historical names for store compatibility, not shipped applications or preconfigured people.

`python3 -B tools/prepare.py` checks hashes, ownership inventory and the no-instance-content rules. `--bindings /private/full-inputs.json --stage /private/new-directory` renders an offline tree only. For this command provide all non-derived bindings as strings; the installer can instead generate fresh values and accept private overrides. Do not unpack either form over a running host. Only explicit installation provisions users, ACLs, mounts, private config and units.

The public packer takes a reviewed file allowlist from source control, never a live server or a Save. It rejects application worktrees, published site bodies, private reader data, instance databases, archives and other state even if mistakenly listed. Keep entire private projects outside the source repository. A local source test is not a live provider or disaster-recovery test.
