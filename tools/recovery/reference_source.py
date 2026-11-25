#!/usr/bin/env python3
"""Collect a PRIVATE source checkpoint, never a machine image or a live state dump.

Run on the source host; stdout is a gzip tar stream. Verify independently with
`python3 reference_source.py --verify FILE`. No services or accounts are changed.
"""
import argparse
import hashlib
import io
import json
import os
import tempfile
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

TG = '/srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent'
WEB = '/srv/pi-workspaces/browser/rootfs/opt/pi-web'
# No recursive workspace copies. New filenames require a deliberate review.
GROUPS = [
    ('telegram', TG, ('agent_runtime.py agent_server.py agent_tools.ts approval_state.py archive_sync.py conversation_profiles.py debri_archive.py image_delivery.py lc_recovery.py lightcone_archive.py lightcone_context.py live_archive.py model_settings.py participant_memory.py piweb_recall.py public_site.py recent_context.py reply_delivery.py restart_checked.py rich_replies.py showcase_reply.py telegram_blocks.py telegram_search.py telegraph_publish.py tool_policy.py tool-policy.json turn_wait.py typing_client.py web_client.py requirements.lock mathrender/package.json mathrender/package-lock.json mathrender/render.js').split()),
    ('bridge', '/srv/pi-workspaces/browser/rootfs/opt/site-entry', ['main.mjs', 'navigation.js']),
    ('workers/web', '/opt/nikita-web', ['web_service.py', 'web_worker.py', 'requirements.lock', 'reader-door.py']),
    ('workers/image', '/opt/nikita-image', ['image_worker.py', 'requirements.lock']),
    ('workers/science', '/opt/nikita-science', ['worker.py', 'Dockerfile', 'requirements.lock']),
    ('admin', '/usr/local/sbin', ['pi-web-launch', 'nikita-tg-qr', 'nikita-tg-login']),
    ('maintenance', '/usr/local/lib', ['nikita-home-save.py', 'nikita-salon-history.py', 'nikita-salon-piwep.py']),
    ('salon', '/var/www/nikita-site', ['index.html', 'app.js', 'style.css']),
    ('readers', '/var/lib/nikita-live-archive', ['index.html', 'lc-index.html', 'lc-guest.html', 'app.js', 'lc-app.js', 'render.js']),
    ('browser', WEB, ['package.json', 'package-lock.json', 'models.json', 'start.sh']),
]
# Detect common embedded credentials without writing their values to diagnostics.
KEY = re.compile(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{30,})\b|\b\d{7,12}:[A-Za-z0-9_-]{32,}\b')


def content(root=Path('/')):
    groups = list(GROUPS)
    # Browser app code only. Do not walk public archive/data directories or users' projects.
    for folder, extensions in [('server', {'.ts', '.mjs'}), ('public', {'.js', '.css', '.html', '.svg'})]:
        base = WEB + '/' + folder
        names = sorted(p.name for p in (root / base.lstrip('/')).iterdir() if p.suffix in extensions and not p.name.startswith('.'))
        required = 'main.ts' if folder == 'server' else 'chat.html'
        if required not in names:
            raise ValueError('Incomplete browser source: ' + folder)
        groups.append(('browser/' + folder, base, names))
    for prefix, base, names in groups:
        parent = root / base.lstrip('/')
        for name in names:
            p = parent / name
            if p.is_symlink() or not p.is_file() or p.resolve() != parent.resolve() / name:
                raise ValueError('Missing or indirect source: ' + prefix + '/' + name)
            data = p.read_bytes()
            if KEY.search(data):
                raise ValueError('Possible embedded credential; review before export: ' + prefix + '/' + name)
            yield prefix + '/' + name, data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(stream):
    items = dict(content())  # Fail before streaming if any input is missing or flagged.
    manifest = {'format': 1, 'kind': 'private-source-only', 'files': {n: digest(v) for n, v in items.items()}}
    items['manifest.json'] = json.dumps(manifest, sort_keys=True, indent=2).encode()
    with tarfile.open(fileobj=stream, mode='w|gz') as archive:
        for name, data in sorted(items.items()):
            info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o600
            archive.addfile(info, io.BytesIO(data))


def verify(path, target=None):
    hashes, manifest = {}, None
    total = 0
    with tarfile.open(path, 'r:gz') as archive:
        for entry in archive:
            name = entry.name
            total += entry.size
            if (not entry.isfile() or not re.fullmatch(r'[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*', name)
                    or name != str(PurePosixPath(name)) or name in hashes or entry.size > 16*1024*1024
                    or total > 128*1024*1024 or len(hashes) >= 2048):
                raise ValueError('Invalid source entry')
            data = archive.extractfile(entry).read()
            hashes[name] = digest(data)
            if target is not None:
                dest = target / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                with dest.open('xb') as f:
                    f.write(data)
            if name == 'manifest.json':
                manifest = json.loads(data)
    hashes.pop('manifest.json', None)
    if not manifest or manifest.get('format') != 1 or manifest.get('kind') != 'private-source-only' or not hashes or hashes != manifest.get('files'):
        raise ValueError('Source manifest mismatch')
    return len(hashes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--verify', type=Path)
    mode.add_argument('--restore-source', nargs=2, type=Path, metavar=('ARCHIVE','NEW_DIRECTORY'), help='Restore to a new private directory. Never overwrite a running installation.')
    args = parser.parse_args()
    if args.restore_source:
        archive, dest = args.restore_source
        if dest.exists() or dest.is_symlink():
            parser.error('Destination already exists')
        os.umask(0o077)
        with tempfile.TemporaryDirectory(dir=dest.parent) as stage:
            root = Path(stage) / 'source'; root.mkdir()
            count = verify(archive, root)
            # Reserve the name exclusively. Publish only after verification.
            dest.mkdir(mode=0o700)
            root.replace(dest)
        print('Restored source files:', count)
    elif args.verify:
        print('Verified source files:', verify(args.verify))
    else:
        build(sys.stdout.buffer)
