"""Install pinned Piper/Irina locally; no speech assets or recordings in the project Save."""
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import sys
import tarfile
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
from voice_assets import fetch

NAME='nikita-speech-irina-v1'
MODELS='https://huggingface.co/rhasspy/piper-voices/resolve/e5349433ed883a32f893a434dc43a6c66b95ef7c/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx'
NATIVE={'x86_64':'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992','aarch64':'fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb'}

def install():
    target=Path(sys.prefix)/NAME; arch=platform.machine(); sha=NATIVE[arch]
    if target.exists():
        if (target/'piper/piper').is_file() and (target/'irina.onnx').stat().st_size==63201294 and (target/'irina.onnx.json').is_file():return
        raise RuntimeError('Unrecognized speech synthesis install')
    print('Downloading offline Irina speech synthesis voice and engine…',flush=True)
    with tempfile.TemporaryDirectory(dir=sys.prefix,prefix='.tts-install-') as tmp:
        root=Path(tmp);stage=root/'ready';stage.mkdir()
        fetch(MODELS,'8ff38212d23da300bbe3705c645e6e5b9475f0bfde01558eb17813e22acaaaaa',stage/'irina.onnx',63201294)
        fetch(MODELS+'.json','c2ec28bb38e2b59e93b959b3e40348c1afebbd272f30fed5d41205d08e98a9d7',stage/'irina.onnx.json',4765)
        fetch(f'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_{arch}.tar.gz',sha,root/'runtime.tgz',32*1024**2)
        with tarfile.open(root/'runtime.tgz') as tar:
            for m in tar:
                parts=PurePosixPath(m.name).parts
                if not parts or parts[0]!='piper' or '..' in parts:raise ValueError('Unexpected archive path')
                dst=stage.joinpath(*parts)
                if m.isdir():dst.mkdir(parents=True,exist_ok=True);continue
                dst.parent.mkdir(parents=True,exist_ok=True)
                if m.issym() and PurePosixPath(m.linkname).name==m.linkname and m.linkname not in ('.','..'):
                    dst.symlink_to(m.linkname);continue
                if not m.isfile():raise ValueError('Unexpected archive entry')
                with tar.extractfile(m) as src,dst.open('xb') as out:shutil.copyfileobj(src,out)
                dst.chmod(0o755 if m.mode & 0o111 else 0o644)
        os.rename(stage,target)
    print('Offline Irina speech synthesis ready.',flush=True)

if __name__=='__main__':install()
