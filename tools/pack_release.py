#!/usr/bin/env python3
"""Build a deterministic distribution using an explicit allowlist (not the checkout)."""
import argparse, gzip, hashlib, io, tarfile
from pathlib import Path
from prepare import REPO, verify

TOP='pi-web-v0.14.1'
EXTRA=('LICENSE README.md deployment/source.json deployment/bindings.json deployment/binaries.json deployment/platform.json deployment/dependencies.json deployment/ownership.json tools/prepare.py tools/content_boundary.py tools/test_projects.py tools/check.py tools/panel-smoke.py tools/install_config.py tools/ubuntu_install.py tools/test_installer.py tools/pack_release.py docs/reference-install.md docs/ubuntu-install.md docs/releases/v0.14.1.md docs/licenses/README.md docs/licenses/dompurify.txt docs/licenses/inter-OFL.txt docs/licenses/katex-MIT.txt docs/licenses/katex-fonts-OFL.txt docs/licenses/marked.txt docs/licenses/pi-MIT.txt docs/licenses/plotly-MIT.txt').split()

def selected(manifest):return sorted(['rootfs/'+n for n in manifest['files']]+EXTRA)

def pack(dest):
    manifest,_=verify()
    with dest.open('xb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w|',format=tarfile.PAX_FORMAT) as out:
        for name in selected(manifest):
            f=REPO/name
            if f.is_symlink() or not f.is_file():raise ValueError('Unexpected source: '+name)
            data=f.read_bytes();meta=tarfile.TarInfo(TOP+'/'+name);meta.size=len(data);meta.mode=0o644
            out.addfile(meta,io.BytesIO(data))
    return hashlib.sha256(dest.read_bytes()).hexdigest()
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('archive',type=Path);a=ap.parse_args();digest=pack(a.archive);a.archive.with_suffix('.gz.sha256').write_text(digest+'  '+a.archive.name+'\n');print(digest,a.archive.name)
