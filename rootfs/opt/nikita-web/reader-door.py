import http.server, os, re, secrets, socket, socketserver, time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

cfg=Path(os.environ['CREDENTIALS_DIRECTORY'],'reader').read_text()
cookie=re.search(r'"(d33=[0-9a-f]{64}; Path=/; HttpOnly; Secure; SameSite=Lax)"',cfg)[1]
owner_cfg=Path(os.environ['CREDENTIALS_DIRECTORY'],'salon').read_text()
owner_secret=re.search(r'^ "([0-9a-f]{64})" 1;',owner_cfg,re.M)[1]
owner_cookie=f'n33owner={owner_secret}; Path=/nikita/; HttpOnly; Secure; SameSite=Lax'
profiles={'piwep','curvelab','arri','lightcone','lake','owner_dm','guest_dm','individual','salon_nikita','moisimeiz'}
tickets={}
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  global tickets
  now=time.monotonic(); tickets={k:v for k,v in tickets.items() if v[0]>now}
  u=urlsplit(self.path); dest=None; ck=None
  if u.path in ('/issue/debri','/issue/lightcone','/issue/hub') and len(tickets)<512:
   target={'/issue/debri':'/debri/','/issue/lightcone':'/lc/','/issue/hub':'/nikita/'}[u.path]
   profile=parse_qs(u.query).get('chat',[''])[0]
   if u.path=='/issue/hub' and profile in profiles:target+=profile+'/'
   token=secrets.token_urlsafe(32); tickets[token]=(now+30,target,u.path=='/issue/hub');dest='https://@@SITE_HOST@@/nikita/_enter?t='+token
  elif u.path=='/consume':
   hit=tickets.pop(parse_qs(u.query).get('t',[''])[0],None)
   if hit:
    dest=hit[1]
    if hit[2]:ck=owner_cookie
    elif dest=='/lc/':ck=cookie
    # The gateway sets only the Debri cookie on a successful /debri/ redirect.
  self.send_response(303 if dest else 403);self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length','0')
  if dest:self.send_header('Location',dest)
  if ck:self.send_header('Set-Cookie',ck)
  self.end_headers()
s=socketserver.UnixStreamServer('/unused',Handler,bind_and_activate=False);s.socket.close();s.socket=socket.socket(fileno=3);s.serve_forever()
