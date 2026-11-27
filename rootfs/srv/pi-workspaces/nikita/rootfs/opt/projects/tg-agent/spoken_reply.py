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
from telethon.errors import ChatSendVoicesForbiddenError

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
HINT='\n\n[Delivery: this one reply will be spoken aloud. Answer the user directly in a few natural sentences, without markup.]'

GOOGLE_PRESETS = ('gacrux', 'charon-elder', 'gacrux-poem')

def google_packet(line, preset):
    if preset not in GOOGLE_PRESETS: raise ValueError('Unknown Google voice preset')
    return {'gacrux':b'', 'charon-elder':b'\xffcharon-elder\x00', 'gacrux-poem':b'\xffpoetry\x00'}[preset] + line.encode('utf-8')

async def google_wave(line,path,*,preset='gacrux'):
    packet=google_packet(line,preset)
    reader,writer=await asyncio.open_unix_connection(str(GOOGLE_SOCKET))
    try:
        writer.write(packet);await writer.drain();writer.write_eof();size=0
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

def voice_policy(base,message,text,heard=(),*,owner_dm=False,profile=None):
    # Called only after chat admission. Quotes/history never select an output mode.
    if text.startswith('/') or (owner_dm and text.strip().lower()=='ok' and not getattr(message,'media',None)):return False
    prefs=profile or {};typed=prefs.get('textOutput') is True;voice=prefs.get('voiceOutput') is True
    # The preset selects a timbre only after a private profile has selected Google delivery.
    preset = 'charon-elder' if getattr(message,'is_private',False) and prefs.get('voicePreset')=='charon-elder' else 'gacrux'
    if typed or voice:
        microphone=bool(getattr(message,'voice',None)) and not getattr(message,'fwd_from',None)
        return preset if voice and (not typed or microphone) else False
    inputs=(text,*heard) if getattr(message,'voice',None) else (text,)
    if any(re.match(PREFIX+r'(?:ответь|напиши)(?:\s+мне)?\s+текстом'+END,s,re.I) for s in inputs):return False
    mode = requested_turn(message,text,heard) or ('gacrux' if (base/'voice-all-gacrux.enabled').is_dir() else False)
    return preset if mode=='gacrux' else mode

def set_voice_all(base,on):
    marker=base/'voice-all-gacrux.enabled'
    if on:
        if not GOOGLE_ENABLED.is_file():return 'Сначала подключи Gacrux. Режим не включён.'
        marker.mkdir(mode=0o700,exist_ok=True)
    else:
        try:marker.rmdir()
        except FileNotFoundError:pass
    return 'Голосовые ответы Gacrux включены везде без таймера.' if on else 'Голосовые ответы по умолчанию выключены. Голос остаётся по просьбе.'

def owner_voice_command(base,event,owner):
    if not (event.is_private and event.sender_id==owner and event.chat_id==owner and not getattr(event,'out',False)):return None
    text=(event.raw_text or '').strip().lower();m=event.message
    if text not in ('/voice_all on','/voice_all off','/voice_all status'):return None
    if any(getattr(m,k,None) for k in ('fwd_from','reply_to_msg_id','media')):return 'Напиши команду отдельным текстовым сообщением.'
    if text.endswith('status'):return 'Голос по умолчанию: '+('включён.' if (base/'voice-all-gacrux.enabled').is_dir() else 'выключен.')
    return set_voice_all(base,text.endswith(' on'))

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
    limit=1500 if cloud in GOOGLE_PRESETS else (600 if cloud else 1400)
    if not text or len(text)>limit or '```' in text:return None
    if cloud and re.search(r'https?://|(?:sk-|AQ\.|AIza)[A-Za-z0-9_-]{12,}|-----BEGIN .*KEY-----',text,re.I):return None
    line=text.replace('**','').strip() if cloud=='gacrux-poem' else ' '.join(text.replace('**','').split())
    if not line:return None
    async with SLOT:
        try:
            with tempfile.TemporaryDirectory(prefix='nikita-speech-') as folder:
                wav=Path(folder)/'reply.wav';piper=ASSETS/'piper';env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LD_LIBRARY_PATH':str(piper),'OMP_NUM_THREADS':'1'}
                if cloud in GOOGLE_PRESETS:await asyncio.wait_for(google_wave(line,wav,preset=cloud),58)
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
    if mode=='charon-elder' and (type(peer) is not int or peer<=0):return None
    prepared=await prepare(text,cloud=mode) if mode=='qwen' or mode in GOOGLE_PRESETS else await prepare(text)
    if not prepared:return None
    stream,attr=prepared
    # Only a definitive voice rejection can safely fall through to ordinary text.
    try:return await client.send_file(peer,stream,reply_to=mid,voice_note=True,attributes=[attr],mime_type='audio/ogg')
    except ChatSendVoicesForbiddenError:return None
