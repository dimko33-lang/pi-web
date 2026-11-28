"""Owner-gated Salon projections. No Telegram connection, database writes or exports."""
import http.server, json, socket, socketserver, sqlite3
from pathlib import Path

ROOT = Path('/var/lib/nikita-salon-history')
BINDINGS = Path('/etc/nikita-history-views.json')
SECTIONS = {'individual', 'guest_dm', 'salon_nikita', 'moisimeiz'}

def rows(section):
    bindings = json.loads(BINDINGS.read_bytes())
    if section in ('individual', 'guest_dm'):
        peer = bindings['individual']; prefix = f'{peer}-' if peer else None
        path = ROOT/'guest_dm/messages.json'
        if not path.exists(): return []
        return [m for m in json.loads(path.read_bytes()) if bool(prefix and m['key'].startswith(prefix)) == (section == 'individual')]
    peer = bindings[section]
    if not peer: return []
    db = Path('/opt/tg-agent/users')/str(abs(int(peer)))/'conversation.sqlite3'
    if not db.exists(): return []
    with sqlite3.connect(db.as_uri()+'?mode=ro', uri=True, timeout=2) as conn:
        # Local dialogue history has sequence numbers, not Telegram timestamps or permalinks.
        return [{'key':f'local-{i}', 'original':{'id':i}, 'text':text} for i,text in conn.execute("SELECT id,text FROM history WHERE role='assistant' ORDER BY id DESC")]

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        section = self.path.removeprefix('/')
        if section not in SECTIONS: self.send_error(404); return
        try: data = json.dumps(rows(section),ensure_ascii=False).encode()
        except (OSError, ValueError, sqlite3.Error, KeyError): self.send_error(503); return
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','private, no-store'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)

if __name__=='__main__':
    server=socketserver.UnixStreamServer('/unused',Handler,bind_and_activate=False); server.socket.close(); server.socket=socket.socket(fileno=3); server.serve_forever()
