#!/usr/bin/python3 -I
"""Reload only the identified old stock controller; leave TLS, credentials and data in place."""
import http.client
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import time

BASE=Path('/root/PiWebRuntime'); APP=BASE/'app'; REMOTE=BASE/'remote-access'


def load():
    if not (REMOTE/'instance').is_file(): return
    matches=[]
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            args=(proc/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
            if args[1:] != [b'--import',b'tsx',b'server/main.ts'] or (proc/'cwd').resolve()!=APP: continue
            exe=(proc/'exe').resolve()
            if proc.stat().st_uid!=0 or exe.name!='node' or exe.parent.parent.parent!=BASE: continue
            matches.append((proc,exe))
        except (FileNotFoundError,ProcessLookupError): pass
    if not matches: return
    if len(matches)!=1: raise RuntimeError('Ambiguous browser process, refusing restart')
    proc,exe=matches[0];fd=os.pidfd_open(int(proc.name));env=dict(x.split(b'=',1) for x in (proc/'environ').read_bytes().split(b'\0') if b'=' in x)
    ident=(REMOTE/'instance').read_text().strip()
    if env.get(b'PI_WEB_INSTANCE')!=ident.encode() or env.get(b'PI_WEB_TICKET_FILE')!=os.fsencode(REMOTE/'access-link.json'):
        raise RuntimeError('Not the managed HTTPS controller')
    port=int(env[b'PORT']); cookie=''
    def request(method,path,body=None):
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=4)
        try:
            conn.request(method,path,body=json.dumps(body) if body is not None else None,headers={'Cookie':cookie,'Content-Type':'application/json'})
            r=conn.getresponse()
            if r.getheader('X-Pi-Web-Instance')!=ident: raise RuntimeError('Instance mismatch')
            return r.status,r.getheader('Set-Cookie','').split(';')[0],r.read()
        finally: conn.close()
    if request('GET','/profiles')[0]!=401: raise RuntimeError('Private gate not found')
    key=json.loads((REMOTE/'access-link.json').read_text())['key']
    status,cookie,_=request('POST','/open',{'key':key});
    if status!=204 or not cookie: raise RuntimeError('Cannot inspect private controller status')
    try:
        status,_,raw=request('GET','/api/settings');settings=json.loads(raw)
        if status!=200 or not settings.get('ok'): raise RuntimeError('Cannot verify controller status')
        if settings.get('capabilities',{}).get('root') is True: return
        if settings.get('busy') is not False: raise RuntimeError('Active browser turn; retry installation after it finishes')
        poll=select.poll();poll.register(fd,select.POLLIN)
        signal.pidfd_send_signal(fd,signal.SIGTERM)
        if not poll.poll(10000): raise RuntimeError('Controller did not stop; not starting another')
        env[b'PI_WEB_PI_BIN']=os.fsencode(BASE/'pi-cli/node_modules/.bin/pi');env.pop(b'PI_WEB_BROWSER_ADMIN',None)
        with (REMOTE/'app.log').open('ab') as log:
            child=subprocess.Popen([str(exe),'--import','tsx','server/main.ts'],cwd=APP,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,umask=0o077)
        for _ in range(100):
            if child.poll() is not None: break
            try:
                status,_,raw=request('GET','/api/settings'); new=json.loads(raw)
                if status==200 and new.get('capabilities',{}).get('root') is True and new['settings']['root'] is False:
                    print('Updated browser controller is ready; existing HTTPS link retained, Root off.');return
            except (ConnectionError,OSError): pass
            time.sleep(.15)
        raise RuntimeError('Controller did not pass its private health check; see remote-access/app.log')
    finally:
        os.close(fd)
        try: request('POST','/api/logout',{})
        except (ConnectionError,OSError): pass

if __name__=='__main__': load()
