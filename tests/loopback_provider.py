"""Synthetic Pi home and local OpenAI-compatible endpoint. No external model or Telegram access."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading
from unittest.mock import patch


def user_payload(request):
    content = next(m['content'] for m in reversed(request['messages']) if m['role'] == 'user')
    return content if isinstance(content,str) else '\n'.join(p.get('text','') for p in content if isinstance(p,dict))


@contextmanager
def local_provider(root, reply=lambda index: 'Fixture answer', *, vision=False):
    seen = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            if self.headers.get('Authorization') != 'Bearer loopback-fixture': self.send_error(401); return
            seen.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            for delta, reason in (({'role':'assistant','content':reply(len(seen))},None),({},'stop')):
                event = {'id':'local','object':'chat.completion.chunk','model':'test','choices':[{'index':0,'delta':delta,'finish_reason':reason}]}
                self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler); thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        agent=root/'fixture-agent'; agent.mkdir(mode=0o700)
        (agent/'models.json').write_text(json.dumps({'providers':{'fixture':{'baseUrl':f'http://127.0.0.1:{server.server_port}/v1','api':'openai-completions','models':[{'id':'test','name':'Fixture','input':['text','image'] if vision else ['text'],'contextWindow':200000,'maxTokens':512}]}}}))
        (agent/'auth.json').write_text(json.dumps({'fixture':{'type':'api_key','key':'loopback-fixture'}}))
        with patch.dict(os.environ,{'HOME':str(root),'PI_CODING_AGENT_DIR':str(agent)}): yield seen
    finally:
        server.shutdown();server.server_close();thread.join()
