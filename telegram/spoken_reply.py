"""Opt-in, one-turn speech delivery after the normal conversation admission checks. No ambient mode or network TTS."""
import asyncio
from array import array
import io
import os
from pathlib import Path
import re
import sys
import tempfile
import wave
from telethon import types,utils

ASSETS=Path(sys.prefix)/'nikita-speech-irina-v1'
ENCODER=Path(__file__).resolve().parent/'media-decoder/voice-pack.cjs'
SLOT=asyncio.Semaphore(1)
TRIGGER=re.compile(r'^\s*(?:@[\w]+[\s,!:—–-]+)?(?:никита[\s,!:—–-]+|[а-яё]{2,24},\s+)?поговори\s+со\s+мной(?=$|[\s,.!?:;…—–-])',re.I)
HINT='\n\n[Delivery: this one reply will be spoken aloud. Answer the user directly in a few natural sentences, without markup.]'

def requested(message,text):
    return not getattr(message,'fwd_from',None) and bool(TRIGGER.match(text or ''))

async def run(argv,*,stdin,stdout,env=None,data=None):
    proc=await asyncio.create_subprocess_exec(*argv,stdin=stdin,stdout=stdout,stderr=asyncio.subprocess.DEVNULL,env=env)
    try:
        out,_=await asyncio.wait_for(proc.communicate(data),60)
        if proc.returncode:raise ValueError('Speech preparation failed')
        return out
    finally:
        if proc.returncode is None:
            try:proc.kill()
            except ProcessLookupError:pass
            await proc.wait()

async def prepare(text):
    # Never truncate a substantive answer to fit; fall back to its original text.
    if not text or len(text)>1400 or '```' in text:return None
    line=' '.join(text.replace('**','').split())
    if not line:return None
    async with SLOT:
        try:
            with tempfile.TemporaryDirectory(prefix='nikita-speech-') as folder:
                wav=Path(folder)/'reply.wav';piper=ASSETS/'piper';env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LD_LIBRARY_PATH':str(piper),'OMP_NUM_THREADS':'1'}
                await run([str(piper/'piper'),'-q','-m',str(ASSETS/'irina.onnx'),'--espeak_data',str(piper/'espeak-ng-data'),'--length_scale','1.08','--sentence_silence','0.35','-f',str(wav)],stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.DEVNULL,env=env,data=(line+'\n').encode())
                if not 44<wav.stat().st_size<=16*1024**2:return None
                with wave.open(str(wav),'rb') as src:
                    n=src.getnframes();rate=src.getframerate()
                    if src.getnchannels()!=1 or src.getsampwidth()!=2 or not 0<n<=rate*180:return None
                    samples=array('h');samples.frombytes(src.readframes(n));stride=max(1,n//100)
                    peaks=[max((abs(v) for v in samples[i:i+stride:8]),default=0) for i in range(0,n,stride)][:100];top=max(peaks)
                    if not top:return None
                    waveform=utils.encode_waveform(bytes(round(31*p/top) for p in peaks))
                with wav.open('rb') as src:opus=await run(['node','--max-old-space-size=96','--wasm-max-mem-pages=4096',str(ENCODER)],stdin=src,stdout=asyncio.subprocess.PIPE)
                if not opus.startswith(b'OggS') or b'OpusHead' not in opus[:128]:return None
                stream=io.BytesIO(opus);stream.name='voice.ogg'
                return stream,types.DocumentAttributeAudio(duration=max(1,round(n/rate)),voice=True,waveform=waveform)
        except (OSError,ValueError,EOFError,wave.Error,asyncio.TimeoutError):return None

async def send_spoken(client,peer,mid,text):
    prepared=await prepare(text)
    if not prepared:return None
    stream,attr=prepared
    # A transport error after submission is uncertain: never retry it as text here.
    return await client.send_file(peer,stream,reply_to=mid,voice_note=True,attributes=[attr],mime_type='audio/ogg')
