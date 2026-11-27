#!/usr/bin/env python3
"""Exercise the actual Node panel on loopback inside a disposable fixture; never attach Telegram."""
import http.client,json,os,secrets,socket,subprocess,sys,tempfile,time
from pathlib import Path
from shutil import which
from check import check
from prepare import verify
m,s=verify()
with tempfile.TemporaryDirectory(prefix='reference-panel-fixture-') as tmp:
    scratch=Path(tmp);panel=check(scratch/'image',s,m);home=scratch/'home';home.mkdir();store=scratch/'profile-data';store.mkdir();base=scratch/'base.txt';base.write_text('Offline fixture base.');key=secrets.token_hex(32)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env={'PATH':str(Path(which('node')).parent)+':/usr/bin:/bin','HOME':str(home),'PORT':str(port),'PI_WEB_PASSWORD':key,'PI_WEB_TELEGRAM_DATA':str(store),'PI_WEB_TELEGRAM_BASE':str(base),'PI_WEB_CONVERSATION_PROFILES':json.dumps([{'id':'owner_dm','kind':'private','label':'Example owner'},{'id':'piwep','kind':'group','label':'Example group','chatId':-101}])}
    # Dependency installation, if needed, is only in this temporary fixture.
    subprocess.run(['npm','ci','--no-audit','--no-fund','--ignore-scripts'],cwd=panel,env=env,check=True)
    def req(method,path,body=None,cookie=''):
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=5);conn.request(method,path,body=None if body is None else json.dumps(body),headers={'Content-Type':'application/json','Cookie':cookie});r=conn.getresponse();data=r.read();cookies='; '.join(v.split(';',1)[0] for k,v in r.getheaders() if k.lower()=='set-cookie');conn.close();return r.status,data,cookies
    with (scratch/'panel.log').open('w+') as log:
        proc=subprocess.Popen(['node','--import','tsx','server/main.ts'],cwd=panel,env=env,stdout=log,stderr=log)
        try:
            for _ in range(150):
                if proc.poll() is not None:log.seek(0);raise RuntimeError(log.read()[-2000:])
                try:status,_,_=req('GET','/api/conversation-profiles');break
                except OSError:time.sleep(.1)
            else:raise RuntimeError('Panel did not listen')
            assert status==401,status
            status,_,cookie=req('GET','/?key='+key);assert status==302 and cookie,status
            status,html,_=req('GET','/profiles',cookie=cookie);assert status==200 and b'Old Chat' in html and b'New Chat' in html and b'/go/hub' in html
            status,data,_=req('GET','/api/conversation-profiles',cookie=cookie);assert status==200,(status,data[:150]);j=json.loads(data);assert [(x['id'],x['kind']) for x in j['profiles']]==[('owner_dm','private'),('piwep','group')];assert all(x['settings']['basePrompt']=='Offline fixture base.' for x in j['profiles'])
            print('Real panel: anonymous API denied; authenticated profile page and independent DM/group catalog loaded. No provider or Telegram client used.')
        finally:
            if proc.poll() is None:proc.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
