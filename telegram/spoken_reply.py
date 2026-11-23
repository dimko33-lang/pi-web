"""Opt-in, one-turn speech delivery after the normal conversation admission checks. Configured voice for requested replies; ordinary turns stay text."""
import asyncio
from array import array
import io
import hashlib
import os
from pathlib import Path
import re
import sys
import tempfile
import wave
from telethon import types,utils

ASSETS=Path(sys.prefix)/'nikita-speech-irina-v1'
ENCODER=Path(__file__).resolve().parent/'media-decoder/voice-pack.cjs'
INSTANCE=hashlib.sha256(os.fsencode(Path(sys.prefix).resolve())).hexdigest()[:12]
GOOGLE_ENABLED=Path('/etc/pi-web-speech')/INSTANCE/'enabled'
GOOGLE_SOCKET=Path('/run')/('pi-web-gacrux-'+INSTANCE+'.sock')
SLOT=asyncio.Semaphore(1)
PREFIX=r'^\s*(?:@[\w]+[\s,!:—–-]+)?(?:никита[\s,!:—–-]+|[а-яё]{2,24},\s+)?'
END=r'(?=$|[\s,.!?:;…—–-])'
TRIGGER=re.compile(PREFIX+r'поговори\s+со\s+мной'+END,re.I)
CLOUD=re.compile(PREFIX+r'ответь\s+(?:облачным\s+голосом|голосом\s+(?:qwen|квен))'+END,re.I)
CLOUD_FAILED='Не удалось озвучить ответ через Qwen. Вот он текстом:\n\n'
HINT='\n\n[Delivery: this one reply will be spoken aloud. Answer the user directly in a few natural sentences, without markup.]'

def cloud_failure(mode):
    return CLOUD_FAILED.replace('Qwen','Google Gacrux') if mode=='gacrux' else CLOUD_FAILED

async def google_wave(line,path):
    reader,writer=await asyncio.open_unix_connection(str(GOOGLE_SOCKET))
    try:
        writer.write(line.encode());await writer.drain();writer.write_eof();size=0
        with path.open('xb') as dst:
            while block:=await reader.read(65536):
                size+=len(block)
                if size>9*1024**2:raise ValueError('Oversize speech reply')
                dst.write(block)
    finally:
        writer.close();await writer.wait_closed()

def requested(message,text,*,transcribed=False):
    if getattr(message,'fwd_from',None):return False
    if transcribed and not getattr(message,'voice',None):return False
    phrase=text or '';m=CLOUD.match(phrase)
    if m and re.search(r'(?:qwen|квен)$',m.group(),re.I):return 'qwen'
    if m or TRIGGER.match(phrase):return 'gacrux' if GOOGLE_ENABLED.is_file() else 'qwen'
    return False

def requested_turn(message,text,heard=()):
    return requested(message,text) or next((v for s in heard if (v:=requested(message,s,transcribed=True))),False)

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

async def prepare(text,*,cloud=False):
    # Never truncate a substantive answer to fit; fall back to its original text.
    if not text or len(text)>(600 if cloud else 1400) or '```' in text:return None
    if cloud and re.search(r'https?://|(?:sk-|AQ\.|AIza)[A-Za-z0-9_-]{12,}|-----BEGIN .*KEY-----',text,re.I):return None
    line=' '.join(text.replace('**','').split())
    if not line:return None
    async with SLOT:
        try:
            with tempfile.TemporaryDirectory(prefix='nikita-speech-') as folder:
                wav=Path(folder)/'reply.wav';piper=ASSETS/'piper';env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LD_LIBRARY_PATH':str(piper),'OMP_NUM_THREADS':'1'}
                if cloud=='gacrux':await asyncio.wait_for(google_wave(line,wav),58)
                elif cloud:
                    with wav.open('xb') as dst:
                        await run([sys.executable,'-I','-B',str(Path(__file__).with_name('qwen_tts.py'))],stdin=asyncio.subprocess.PIPE,stdout=dst,env={'PATH':env['PATH']},data=line.encode())
                else:await run([str(piper/'piper'),'-q','-m',str(ASSETS/'irina.onnx'),'--espeak_data',str(piper/'espeak-ng-data'),'--length_scale','1.08','--sentence_silence','0.35','-f',str(wav)],stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.DEVNULL,env=env,data=(line+'\n').encode())
                if not 44<wav.stat().st_size<=16*1024**2:return None
                with wave.open(str(wav),'rb') as src:
                    n=src.getnframes();rate=src.getframerate()
                    if src.getnchannels()!=1 or src.getsampwidth()!=2 or not 0<n<=rate*180:return None
                    samples=array('h');samples.frombytes(src.readframes(n));stride=max(1,n//100)
                    if len(samples)!=n:return None
                    peaks=[max((abs(v) for v in samples[i:i+stride:8]),default=0) for i in range(0,n,stride)][:100];top=max(peaks)
                    if not top:return None
                    waveform=utils.encode_waveform(bytes(round(31*p/top) for p in peaks))
                with wav.open('rb') as src:opus=await run(['node','--max-old-space-size=96','--wasm-max-mem-pages=4096',str(ENCODER)],stdin=src,stdout=asyncio.subprocess.PIPE)
                if not opus.startswith(b'OggS') or b'OpusHead' not in opus[:128]:return None
                stream=io.BytesIO(opus);stream.name='voice.ogg'
                return stream,types.DocumentAttributeAudio(duration=max(1,round(n/rate)),voice=True,waveform=waveform)
        except (OSError,ValueError,EOFError,wave.Error,asyncio.TimeoutError):return None

async def send_spoken(client,peer,mid,text,*,mode='qwen'):
    prepared=await prepare(text,cloud=mode) if mode in ('qwen','gacrux') else await prepare(text)
    if not prepared:return None
    stream,attr=prepared
    # A transport error after submission is uncertain: never retry it as text here.
    return await client.send_file(peer,stream,reply_to=mid,voice_note=True,attributes=[attr],mime_type='audio/ogg')
