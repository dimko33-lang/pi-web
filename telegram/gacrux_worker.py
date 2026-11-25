"""Socket-activated local worker. Only this unit can read the systemd Google credential."""
import base64
import io
import json
import os
from pathlib import Path
import re
import sys
import urllib.request as http
import wave

URL='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent'
MAX_CHARS=1500
MAX_INPUT_BYTES=4*MAX_CHARS  # Allow every Unicode code point at the character limit.
class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self,*args): return None

# Plain UTF-8 remains the original Gacrux protocol. A literal chat message cannot start with 0xff.
CHARON_HEADER = b'\xffcharon-elder\x00'
CHARON_STYLE = ('Speak these exact Russian words to one person in a quiet room. An older man with a settled, '
                'low middle register, like an elder monk in everyday conversation. Be attentive and unhurried, '
                'with clear words, short natural pauses and gentle falling endings. Keep your face at rest: '
                'no audible smile. No chanting, preaching, stage whisper, artificial tremor or theatrical gravel. '
                'Do not add a greeting, blessing or any words of your own.\n\n')


def decode_request(data):
    preset = 'gacrux'
    if data.startswith(CHARON_HEADER):
        preset = 'charon-elder'; data = data[len(CHARON_HEADER):]
    if len(data)>MAX_INPUT_BYTES: raise ValueError('Too long')
    return data.decode('utf-8'), preset  # Unknown binary frames fail closed, including on older workers.


def render(text,key,open_url,*,preset='gacrux'):
    if not text.strip() or len(text)>MAX_CHARS: raise ValueError('Short speech required')
    voice='Gacrux'
    style='Say these exact words in Russian to one adult standing opposite you. This is an ordinary conversation, not a reading. Use your comfortable middle register. State the first thought plainly and finish it. Take one quiet beat before the last clause. Let the final stressed syllable settle downwards. Your face is at rest: no audible smile, no coaxing, no disdain to perform. The irony is in the wording; leave it there.\n\n'
    if preset=='charon-elder': voice,style='Charon',CHARON_STYLE
    elif preset!='gacrux': raise ValueError('Unknown voice preset')
    payload={'contents':[{'parts':[{'text':style+text}]}],'generationConfig':{'responseModalities':['AUDIO'],'speechConfig':{'voiceConfig':{'prebuiltVoiceConfig':{'voiceName':voice}}}}}
    req=http.Request(URL,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','x-goog-api-key':key})
    with open_url(req,timeout=48) as response: raw=response.read(12*1024**2+1)
    if len(raw)>12*1024**2: raise ValueError('Oversize reply')
    j=json.loads(raw);blocks=[]
    for part in j['candidates'][0]['content']['parts']:
        item=part.get('inlineData',{});mime=item.get('mimeType','').lower().replace(' ','')
        if not item:continue
        if not re.fullmatch(r'audio/l16;rate=24000(?:;channels=1)?',mime):raise ValueError('Unexpected audio type')
        blocks.append(base64.b64decode(item['data'],validate=True))
    pcm=b''.join(blocks)
    if len(pcm)%2 or not 0<len(pcm)<=24000*2*180:raise ValueError('Invalid audio duration')
    out=io.BytesIO()
    with wave.open(out,'wb') as dst:dst.setparams((1,2,24000,0,'NONE',''));dst.writeframes(pcm)
    return out.getvalue()

if __name__=='__main__':
    try:
        text,preset=decode_request(sys.stdin.buffer.read(MAX_INPUT_BYTES+len(CHARON_HEADER)+1))
        key=(Path(os.environ['CREDENTIALS_DIRECTORY'])/'google-key').read_text().strip()
        opener=http.build_opener(http.ProxyHandler({}),NoRedirect())
        sys.stdout.buffer.write(render(text,key,opener.open,preset=preset))
    except Exception:
        # Never log request content, credentials or upstream response bodies.
        sys.exit(1)
