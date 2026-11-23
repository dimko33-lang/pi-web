"""Local ASR for one newly addressed private Telegram voice note. Never scan replies or history."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
from motion_frames import BoundedSink, LIMIT

ROOT=Path(__file__).resolve().parent
SLOT=asyncio.Semaphore(1)


def is_voice(message):
    # Telethon sets .voice only for DocumentAttributeAudio(voice=True), not music/files.
    return bool(getattr(message,'voice',None))


class VoiceError(Exception): pass


async def recognize(message,download):
    size=getattr(getattr(message,'file',None),'size',0) or 0
    if not is_voice(message) or not 0<size<=LIMIT:raise VoiceError('Не удалось прочитать голосовое сообщение.')
    children=[]
    env={'PATH':os.environ.get('PATH','/usr/local/bin:/usr/bin:/bin'),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
    try:
        async with SLOT:
            try:
                with tempfile.TemporaryFile() as source:
                    sink=BoundedSink(source,size);sink.room(size)
                    await asyncio.wait_for(download(message,file=sink),max(45,min(3600,45+size//131072)))
                    if sink.count!=size:raise ValueError('Incomplete Telegram download')
                    source.flush();source.seek(0)
                    r,w=os.pipe()
                    try:
                        recog=await asyncio.create_subprocess_exec(sys.executable,'-I','-B',str(ROOT/'voice_recognize.py'),stdin=r,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,env=env);children.append(recog)
                        decoder=await asyncio.create_subprocess_exec('node','--max-old-space-size=96','--wasm-max-mem-pages=4096',str(ROOT/'media-decoder/voice-pcm.cjs'),stdin=source,stdout=w,stderr=asyncio.subprocess.DEVNULL,env=env);children.append(decoder)
                    finally:os.close(r);os.close(w)
                    code,(out,_)=await asyncio.wait_for(asyncio.gather(decoder.wait(),recog.communicate()),1200)
                    if code or recog.returncode:raise ValueError('Voice processing failed')
                    text=json.loads(out)['text'].strip()
                    if not text:raise VoiceError('Не разобрала речь. Можешь повторить или написать текстом?')
                    return text
            finally:
                for p in children:
                    if p.returncode is None:
                        try:p.kill()
                        except ProcessLookupError:pass
                if children:await asyncio.gather(*(p.wait() for p in children))
    except (OSError,ValueError,KeyError,BufferError,asyncio.TimeoutError):
        raise VoiceError('Не получилось распознать голосовое. Можешь повторить или написать текстом?') from None


def voice_prompt(text):
    # Deliberately not a literal command, approval or an owner request-inspection trigger.
    return '[Новое голосовое сообщение пользователя, распознано автоматически]:\n'+text
