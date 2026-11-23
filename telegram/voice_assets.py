"""Provision pinned offline GigaAM assets outside the app/save, under the Telegram venv."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

NAME = 'nikita-gigaam-v3-q8-tc042'
RELEASE = 'https://github.com/handy-computer/transcribe.cpp/releases/download/v0.4.2/'
MODEL = 'https://huggingface.co/handy-computer/gigaam-v3-e2e-rnnt-gguf/resolve/3efd5b39882ceadca5570a8fb9fa1a2c801d6d6d/gigaam-v3-e2e-rnnt-Q8_0.gguf'
MODEL_SHA = '78d63b47723b7f8d78c6113a6ef983b5a86e2a86f6c273e1f5cb6967b1c4467a'
WRAPPER_SHA = '2e4a5d3e7ba78918969ccb1ee06f3d5c6c79664e0626d0da0ffe832f465e6d51'
NATIVE = {'x86_64':'4fe87db8919ea34e461db7987713b580f54e6f3ed610457c5d8fb8eac1a15046',
          'aarch64':'5e9cc7b244949fc686d1272e796e965411e80cc768533f1704c3c53e4c7d695e'}


def fetch(url, digest, dest, limit):
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=120) as src, dest.open('xb') as dst:
        while block := src.read(512*1024):
            dst.write(block); h.update(block)
            if dst.tell() > limit: raise ValueError('Unexpected speech asset size')
    if h.hexdigest() != digest: raise ValueError('Speech asset checksum mismatch')


def install():
    arch = platform.machine(); native_sha = NATIVE[arch]
    target = Path(sys.prefix)/NAME; manifest = [MODEL_SHA, WRAPPER_SHA, native_sha]
    if target.exists():
        if (json.loads((target/'installed.json').read_text()) == manifest and
            (target/'model.gguf').stat().st_size == 273724832 and (target/'native/libtranscribe.so').is_file() and
            (target/'wrapper/transcribe_cpp/__init__.py').is_file()): return
        raise RuntimeError('Unrecognized speech assets; not replacing them')
    print('Downloading GigaAM v3 Russian speech model (274 MB) and CPU runtime…', flush=True)
    with tempfile.TemporaryDirectory(dir=sys.prefix, prefix='.voice-install-') as tmp:
        root = Path(tmp); stage = root/'ready'; stage.mkdir(); native = stage/'native'; native.mkdir()
        fetch(MODEL, MODEL_SHA, stage/'model.gguf', 273724832)
        fetch(RELEASE+f'transcribe-native-0.4.2-linux-{arch}-cpu-vulkan.tar.gz', native_sha, root/'runtime.tgz', 32*1024**2)
        fetch(RELEASE+'transcribe_cpp-0.4.2-py3-none-any.whl', WRAPPER_SHA, root/'wrapper.zip', 100000)
        with tarfile.open(root/'runtime.tgz') as tar:
            for m in tar:
                parts = PurePosixPath(m.name).parts
                if not m.isfile() or len(parts)<2 or parts[0]!=f'transcribe-native-linux-{arch}-cpu-vulkan' or '..' in parts: continue
                p = native.joinpath(*parts[1:]); p.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(m) as src, p.open('xb') as dst: shutil.copyfileobj(src, dst)
        with zipfile.ZipFile(root/'wrapper.zip') as z: z.extractall(stage/'wrapper')  # exact verified wheel
        if not (native/'libtranscribe.so').is_file(): raise ValueError('Missing native speech runtime')
        (stage/'installed.json').write_text(json.dumps(manifest)); os.rename(stage, target)
    print('Offline GigaAM speech recognition ready.', flush=True)

if __name__ == '__main__': install()
