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
class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self,*args): return None

def render(text,key,open_url):
    if not 0<len(text.strip())<=600: raise ValueError('Short speech required')
    style='Say these exact words in Russian to one adult standing opposite you. This is an ordinary conversation, not a reading. Use your comfortable middle register. State the first thought plainly and finish it. Take one quiet beat before the last clause. Let the final stressed syllable settle downwards. Your face is at rest: no audible smile, no coaxing, no disdain to perform. The irony is in the wording; leave it there.\n\n'
    payload={'contents':[{'parts':[{'text':style+text}]}],'generationConfig':{'responseModalities':['AUDIO'],'speechConfig':{'voiceConfig':{'prebuiltVoiceConfig':{'voiceName':'Gacrux'}}}}}
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
        data=sys.stdin.buffer.read(2401)
        if len(data)>2400:raise ValueError('Too long')
        key=(Path(os.environ['CREDENTIALS_DIRECTORY'])/'google-key').read_text().strip()
        opener=http.build_opener(http.ProxyHandler({}),NoRedirect())
        sys.stdout.buffer.write(render(data.decode(),key,opener.open))
    except Exception:
        # Never log request content, credentials or upstream response bodies.
        sys.exit(1)
