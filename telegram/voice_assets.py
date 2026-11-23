"""Install a pinned offline Russian recognizer in the Telegram venv, never in the app Save."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tempfile
import urllib.request
import zipfile

NAME='nikita-voice-ru-v1'
MODEL='vosk-model-small-ru-0.22'
MODEL_SHA='961d5ff98a17f4aa6de69864d0aa71fa5bac682301d2b5d17a3f24c5c99a46d4'
WHEELS={
 'x86_64':('fc/ca/83398cfcd557360a3d7b2d732aee1c5f6999f68618d1645f38d53e14c9ff/vosk-0.3.45-py3-none-manylinux_2_12_x86_64.manylinux2010_x86_64.whl','25e025093c4399d7278f543568ed8cc5460ac3a4bf48c23673ace1e25d26619f'),
 'aarch64':('a4/23/3130a69fa0bf4f5566a52e415c18cd854bf561547bb6505666a6eb1bb625/vosk-0.3.45-py3-none-manylinux2014_aarch64.whl','54efb47dd890e544e9e20f0316413acec7f8680d04ec095c6140ab4e70262704')}

def fetch(url,digest,dest):
    h=hashlib.sha256()
    with urllib.request.urlopen(url,timeout=90) as src,dest.open('xb') as dst:
        while block:=src.read(256*1024):
            dst.write(block);h.update(block)
            if dst.tell()>64*1024**2:raise ValueError('Unexpected voice asset size')
    if h.hexdigest()!=digest:raise ValueError('Voice asset checksum mismatch')

def install():
    base=Path(sys.prefix);target=base/NAME
    wheel,digest=WHEELS[platform.machine()];version=[MODEL_SHA,digest]
    if target.is_dir() and json.loads((target/'installed.json').read_text())==version and (target/'libvosk.so').is_file() and (target/MODEL/'am/final.mdl').is_file():return
    if target.exists():raise RuntimeError('Unrecognized voice runtime, not replacing it')
    print('Downloading offline Russian speech model and engine…',flush=True)
    with tempfile.TemporaryDirectory(dir=base,prefix='.voice-install-') as tmp:
        root=Path(tmp);stage=root/'ready';stage.mkdir(mode=0o755)
        fetch('https://files.pythonhosted.org/packages/'+wheel,digest,root/'engine.zip')
        fetch('https://alphacephei.com/vosk/models/'+MODEL+'.zip',MODEL_SHA,root/'model.zip')
        with zipfile.ZipFile(root/'engine.zip') as z, z.open('vosk/libvosk.so') as src,(stage/'libvosk.so').open('xb') as dst:shutil.copyfileobj(src,dst)
        with zipfile.ZipFile(root/'model.zip') as z:z.extractall(stage) # exact trusted archive checked above
        (stage/'installed.json').write_text(json.dumps(version));os.rename(stage,target)
    print('Offline voice recognition ready.',flush=True)

if __name__=='__main__':install()
