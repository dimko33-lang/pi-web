"""Explicitly enrolled prepaid Avatar 6 renderer. Never retry a paid submission."""
import contextlib
import struct
import sys
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from circle_media import circle_duration, speech_pcm

API = 'https://api.heygen.com/v3/'
MODEL = 'heygen-avatar-6'
USD_SECOND = .10  # Public self-serve Avatar 6 1080p rate, not Turbo.


def inputs(d):
    wav = d/'speech.wav'; dur = len(speech_pcm(wav)) / 48000
    img = (d/'portrait.jpg').read_bytes(); audio = wav.read_bytes()
    if not img.startswith(b'\xff\xd8') or len(img)>32*1024**2 or not 1 <= dur <= 30:
        raise ValueError('Expected one JPEG and a 1–30 second WAV')
    def media(b, mime):
        return {'type':'base64','media_type':mime,'data':base64.b64encode(b).decode('ascii')}
    return ({'model':MODEL,'resolution':'1080p','motion_expressiveness':'less',
             'reference_images':[media(img,'image/jpeg')], 'audio':media(audio,'audio/wav')},
            {'seconds':dur,'estimated_usd':round(dur*USD_SECOND, 4),
             'jpeg_sha256':hashlib.sha256(img).hexdigest(),'wav_sha256':hashlib.sha256(audio).hexdigest()})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args): return None


def api(path, key, payload=None):
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(API+path,data=data,headers={'x-api-key':key,'Content-Type':'application/json'})
    # Do not forward a workspace credential or replay a paid POST on a redirect.
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=45) as r:
        return json.load(r)['data']


def persist(d, state):
    with tempfile.NamedTemporaryFile(dir=d,delete=False,mode='w') as out:
        json.dump(state,out);out.flush();os.fsync(out.fileno())
    os.replace(out.name,d/'job.json')


def submit(d,key):
    payload,meta=inputs(d)
    if (d/'submitted.once').exists(): raise RuntimeError('Already attempted; resume or reconcile in dashboard. Never submit again.')
    account=api('users/me',key); wallet=account.get('wallet') or {}
    if wallet.get('currency')!='usd' or wallet.get('remaining_balance') is None or float(wallet['remaining_balance'])<meta['estimated_usd']:
        raise RuntimeError('Cannot confirm sufficient prepaid USD balance; no job submitted')
    if (wallet.get('auto_reload') or {}).get('enabled'):
        raise RuntimeError('Auto reload enabled on workspace; no trial submitted')
    # A crash, ambiguous timeout or missing video_id must not permit a new POST.
    with (d/'submitted.once').open('x') as f:
        f.write(json.dumps(meta));f.flush();os.fsync(f.fileno())
    state={**meta,'submitted_at':time.time(),'status':'submission-unconfirmed'}; persist(d,state)
    answer=api('models/avatars',key,payload); vid=answer.get('video_id')
    if not isinstance(vid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,150}',vid):raise ValueError('Submission unconfirmed; reconcile in dashboard')
    state.update(video_id=vid,status=answer.get('status','pending'));persist(d,state); print('video_id:',vid,flush=True)


def resume(d,key,wait=600):
    state=json.loads((d/'job.json').read_text());vid=state.get('video_id')
    if not vid:raise RuntimeError('Missing video_id: check dashboard; do not resubmit')
    stop=time.monotonic()+wait
    while True:
        try: job=api('models/videos/'+urllib.parse.quote(vid,safe=''),key)
        except (TimeoutError,urllib.error.URLError) as exc:
            if isinstance(exc,urllib.error.HTTPError) and exc.code not in (429,500,502,503,504):raise
            if time.monotonic()>=stop:raise RuntimeError('Polling paused; resume this video_id') from None
            time.sleep(8);continue
        if job.get('video_id')!=vid: raise ValueError('Mismatched receipt')
        status=job['status'];state['status']=status;persist(d,state)
        if status in ('failed','cancelled'):raise RuntimeError('Terminal job: '+str(job.get('failure_code',status)))
        if status=='completed':
            state.setdefault('observed_completed_at',time.time());persist(d,state)
            if (d/'original.mp4').exists():return
            url=job['video_url'];assert urllib.parse.urlsplit(url).scheme=='https'
            with tempfile.TemporaryDirectory(dir=d) as tmp:
                target=Path(tmp)/'download';limit=160*1024**2
                # Signed CDN URL only: never send the API key to media storage.
                with urllib.request.urlopen(url,timeout=45) as r,target.open('xb') as f:
                    while block:=r.read(65536):
                        if f.tell()+len(block)>limit:raise ValueError('Oversize media')
                        f.write(block)
                if target.stat().st_size==0:raise ValueError('Empty media')
                os.link(target,d/'original.mp4');return
        if status not in ('pending','processing'):raise ValueError('Unrecognized job state')
        if time.monotonic()>=stop:raise RuntimeError('Still processing; resume this video_id')
        time.sleep(6)


def verify_audio(file, source):
    import av
    import numpy as np
    from scipy.signal import resample_poly, correlate
    from circle_match import SpeechReceipt
    with av.open(str(file)) as c:
        if len(c.streams.video)!=1 or len(c.streams.audio)!=1: raise ValueError('Expected A/V pair')
        a=c.streams.audio[0];v=c.streams.video[0]
        if not c.duration or c.duration/av.time_base>60:raise ValueError('Invalid media duration')
        res=av.AudioResampler(format='s16',layout='mono',rate=8000)
        pieces=[p.to_ndarray().flatten() for f in c.decode(audio=0) for p in res.resample(f)]
        pieces.extend(p.to_ndarray().flatten() for p in res.resample(None))
        captured=np.concatenate(pieces).astype(float)
        if abs(float(a.start_time*a.time_base-v.start_time*v.time_base))>.2:raise ValueError('Inspect A/V start offset')
        if len(captured)/8000 + .15 < len(source)/48000:raise ValueError('Inspect shortened audio')
    ref=resample_poly(np.frombuffer(source,dtype='<i2').astype(float),1,3)
    model=SpeechReceipt(ref)
    # Receipt normally waits for a quarter-second of trailing room on a live stream.
    # Padding here is for the offline matcher only; require real edge matches first.
    if not model.matches(np.pad(captured,(0,3500))):raise ValueError('Speech edges not verified; hold delivery')
    # Compare short voiced windows near each end against the actual decoded audio.
    # This measures audio timing, not perceptual lip sync. Never synthesize missing samples.
    offsets=[]
    for anchors in model.edges:
        choices=[]
        for pos,w in anchors:
            lo=max(0,pos-3200);hi=min(len(captured),pos+len(w)+3200);part=captured[lo:hi]
            if len(part)<len(w) or w@w<1:continue
            e=np.r_[0.,np.cumsum(part**2)];s=correlate(part,w,mode='valid',method='fft')/np.sqrt(np.maximum(1,e[len(w):]-e[:-len(w)])*(w@w));i=int(s.argmax());choices.append((float(s[i]),(i+lo-pos)/8000))
        if not choices or max(choices)[0]<.55:raise ValueError('Inspect audio alignment')
        offsets.append(max(choices)[1])
    if abs(offsets[1]-offsets[0])>.12 or model.end+round(offsets[1]*8000)>len(captured)+80:
        raise ValueError('Possible drift or clipped speech: inspect before delivery')
    print(file.name,'speech edge offsets (ms):',*[round(v*1000) for v in offsets])


def pack(d):
    wav=speech_pcm(d/'speech.wav'); original=d/'original.mp4';verify_audio(original,wav)
    binary=os.environ.get('CIRCLE_FFMPEG') or shutil.which('ffmpeg')
    if not binary:raise RuntimeError('Set CIRCLE_FFMPEG to a trusted ffmpeg binary')
    with tempfile.TemporaryDirectory(dir=d) as tmp:
        out=Path(tmp)/'circle.mp4'
        # Keep the provider audio and packet timing. Do not trim to the shorter stream.
        subprocess.run([binary,'-nostdin','-v','error','-i',str(original),'-map','0:v:0','-map','0:a:0',
                        '-vf',"crop=min(iw\\,ih):min(iw\\,ih),scale=640:640,setsar=1",'-c:v','libx264','-pix_fmt','yuv420p',
                        '-threads','2','-c:a','aac','-b:a','128k','-movflags','+faststart',str(out)],check=True,timeout=150)
        dur=circle_duration(out);verify_audio(out,wav);os.link(out,d/'circle.mp4');print('circle seconds:',dur)


def work(stream, output, state, creds):
    peer, mid = struct.unpack('!qQ', stream.read(16))
    if peer >= 0 or not mid: raise ValueError('Expected group reply identity')
    wave = stream.read(4*1024**2+1)
    if len(wave)>4*1024**2: raise ValueError('Oversize audio')
    with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(sys.stderr):
        d=Path(folder); (d/'speech.wav').write_bytes(wave)
        shutil.copyfile(creds/'portrait.jpg',d/'portrait.jpg'); inputs(d)
        key=(creds/'heygen-key').read_text().strip()
        # Durable per-install receipt even after timeout, restart or ambiguous response.
        marker=state/hashlib.sha256(f'{peer}:{mid}'.encode()).hexdigest()
        with marker.open('x') as f: f.write('attempted\n'); f.flush(); os.fsync(f.fileno())
        submit(d,key); resume(d,key,wait=590); pack(d)
        path=d/'circle.mp4'; size=path.stat().st_size
        if not 0<size<=40*1024**2: raise ValueError('Invalid output size')
        output.write(struct.pack('!II',size,round(circle_duration(path)*1000)));output.write(path.read_bytes());output.flush()

if __name__=='__main__':
    os.umask(0o077)
    work(sys.stdin.buffer,sys.stdout.buffer,Path(os.environ['STATE_DIRECTORY']),Path(os.environ['CREDENTIALS_DIRECTORY']))
