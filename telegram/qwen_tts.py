"""Explicit single-turn public Qwen demo. No credentials, cookies, retries or user-supplied URLs."""
import json
import re
import sys
import urllib.request as http

HOST='https://qwen-qwen3-tts.hf.space'
CALL=HOST+'/gradio_api/call/generate_voice_design'
FILE=re.compile(re.escape(HOST)+r'/gradio_api/file=/tmp/gradio/[a-f0-9]{64}/audio\.wav')
STYLE='A warm adult female voice, speaking fluent native Russian in casual conversation. Brief pauses, quiet humour when appropriate; not an announcer.'
MAX_WAV=9*1024**2

class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self,*args):return None

def synthesize(line,open_url):
    if not line.strip() or len(line)>600:raise ValueError('Short answer required')
    post=http.Request(CALL,data=json.dumps({'data':[line,'Russian',STYLE]}).encode(),headers={'Content-Type':'application/json'})
    with open_url(post,timeout=12) as r:event_id=json.loads(r.read(2049))['event_id']
    if not isinstance(event_id,str) or not re.fullmatch('[a-f0-9]{32}',event_id):raise ValueError('Invalid event')
    with open_url(CALL+'/'+event_id,timeout=30) as r:
        event='';total=0
        while True:
            raw=r.readline(16385);total+=len(raw)
            if not raw or len(raw)>16384 or total>131072:raise ValueError('Invalid speech response')
            if raw.startswith(b'event:'):event=raw[6:].strip()
            if event==b'error':raise ValueError('Demo unavailable')
            if event==b'complete' and raw.startswith(b'data:'):
                url=json.loads(raw[5:])[0]['url'];break
    if not isinstance(url,str) or not FILE.fullmatch(url):raise ValueError('Unexpected speech output')
    with open_url(url,timeout=15) as r:data=r.read(MAX_WAV+1)
    if len(data)>MAX_WAV or data[:4]!=b'RIFF' or data[8:12]!=b'WAVE':raise ValueError('Invalid WAV')
    return data

if __name__=='__main__':
    # Parent bounds total wall time and only supplies the one final answer on stdin.
    opener=http.build_opener(http.ProxyHandler({}),NoRedirect());line=sys.stdin.buffer.read(4097).decode().strip()
    sys.stdout.buffer.write(synthesize(line,opener.open))
