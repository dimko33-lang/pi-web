#!/usr/bin/env python3
"""Offline tests for installer-specific assumptions; optional real, loopback-only HTTP smoke."""
import argparse,ast,http.client,json,os,shlex,shutil,socket,subprocess,tempfile,time
from pathlib import Path
from http.client import HTTPConnection
from install_config import APP,B,DATA,RELEASE,STATE,TG,catalog,domain_name,new_instance,seeds
from prepare import META,REPO,bindings,load,stage,verify
from ubuntu_install import DEFER,principal

def rejected(call):
    try:call()
    except ValueError:return
    raise AssertionError('Invalid input accepted')

def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def http(p,path,cookie=''):
    c=HTTPConnection('127.0.0.1',p,timeout=6);c.request('GET',path,headers={'Cookie':cookie});r=c.getresponse();data=r.read();heads=r.headers;c.close();return r.status,data,heads

def actual(tree,cfg,seed,tmp):
    panel=tree/APP[1:];store=tree/DATA[1:];home=tmp/'home';home.mkdir();p=port();q=port();assert p!=q
    env={'PATH':str(Path(shutil.which('node')).parent)+':/usr/bin:/bin','HOME':str(home),'PORT':str(p),'PI_WEB_TELEGRAM_DATA':str(store),'PI_WEB_TELEGRAM_BASE':str(tree/TG[1:]/'working-rules.md'),'PI_WEB_PASSWORD':cfg['panelPassword']}
    for line in seed['/etc/pi-web-instance/profile-catalog.env'][0].splitlines():
        k,v=line.split('=',1);env[k]=shlex.split(v)[0]
    subprocess.run(['npm','ci','--no-fund','--no-audit','--ignore-scripts'],cwd=panel,env=env,check=True)
    entry_conf=tree/B[1:]/'etc/site-entry.json';j=json.loads(entry_conf.read_bytes());j['apps'][0]['url']=f'http://127.0.0.1:{p}/';entry_conf.write_text(json.dumps(j));procs=[]
    with (tmp/'smoke.log').open('w+') as log:
        try:
            procs.append(subprocess.Popen(['node','--import','tsx','server/main.ts'],cwd=panel,env=env,stdout=log,stderr=log));procs.append(subprocess.Popen(['node','main.mjs'],cwd=tree/B[1:]/'opt/site-entry',env={**env,'PORT':str(q),'SITE_ENTRY_CONFIG':str(entry_conf)},stdout=log,stderr=log))
            for _ in range(150):
                if any(s.poll() is not None for s in procs):raise RuntimeError('Reference process exited in isolated fixture')
                try:
                    if http(p,'/profiles')[0]==401 and http(q,'/?key=not-an-entry-key')[0]==401:break
                except OSError:pass
                time.sleep(.1)
            else:raise RuntimeError('Reference HTTP service unavailable')
            s,_,h=http(q,'/?key='+cfg['entryKey']);assert s==303 and h['location']=='/';cookie=h['set-cookie'];assert all(i in cookie for i in ('cl_sid=','Secure','HttpOnly'));cookie=cookie.split(';')[0]
            s,data,_=http(p,'/api/conversation-profiles',cookie)
            assert s==200,(s,data[:160]);profiles=json.loads(data)['profiles']
            assert [e['id'] for e in profiles]==[e['id'] for e in catalog(cfg)]
            assert all(not e['settings']['basePrompt'].strip() for e in profiles)
            assert http(p,'/profiles',cookie)[0]==200;assert http(p,'/api/conversation-profiles')[0]==401
            print('Real panel + site-entry: fresh link, native secure cookie, protected UI and only the default DM slots verified. No Telegram or provider contact.')
        finally:
            for s in procs:s.terminate()
            for s in procs:s.wait(timeout=10)

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--http',action='store_true');a=ap.parse_args();mf,sc=verify();cfg=new_instance('install.example');v=bindings(sc,cfg['bindings']);other=new_instance('install.example');seed=seeds(cfg)
    assert domain_name('','8.8.4.4')=='8-8-4-4.sslip.io';rejected(lambda:domain_name('','127.0.0.1'));rejected(lambda:domain_name('a/b.example',''));rejected(lambda:new_instance('a.example',{'PANEL_HOST':'a.example'}));rejected(lambda:new_instance('a.example',{'OWNER_ID':'0'}))
    for key in ('entryKey','panelPassword'):assert cfg[key]!=other[key] and len(cfg[key])>=32
    assert len({cfg['bindings'][k] for k,t in sc.items() if t in ('secret64','access-token')})==4
    for kind,names in load(META/'ownership.json').items():
        if kind in ('dirs','files'):
            for n,i in names.items():assert all(principal(n,i)[k] for k in ('user','group'))
    assert all(seed[n][1] in (0o600,0o640) for n in [B+'/etc/site-entry.json',B+'/etc/pi-web.env']);assert not any(p.endswith(('.session','/telegram-client.json','/telegram-enrolled','/auth.json','/google-key','/anam-key','/heygen-key')) for p in seed)
    assert [p['id'] for p in catalog(cfg)]==['owner_dm','guest_dm']
    bound=new_instance('install.example',{'LAB_PEER':'1002000009876'})
    assert [(p['label'],p['chatId']) for p in catalog(bound) if p['kind']=='group']==[('App project',-1002000009876)]
    for name in DEFER:
        gate=name.replace('.timer','.service');assert 'ConditionPathExists' in seed['/etc/systemd/system/'+gate+'.d/99-enrollment.conf'][0]
    for name in ('tools/ubuntu_install.py','tools/install_config.py','tools/pack_release.py','tools/test_installer.py'):ast.parse((REPO/name).read_text())
    with tempfile.TemporaryDirectory() as d:
        tmp=Path(d);tree=tmp/'image';stage(mf,v,tree)
        for p,(text,_,_,_) in seed.items():
            dst=tree/p[1:];assert not dst.exists(),p;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(text)
        assert (tree/APP[1:]/'models.json').is_file() and (tree/APP[1:]/'server/pi-context-reader.mjs').is_file();assert json.loads((tree/DATA[1:]/'settings.json').read_bytes())=={}
        unit=tree/'etc/systemd/system/pi-nikita.service';envfiles=[]
        for part in [unit,*sorted(unit.with_suffix('.service.d').glob('*.conf'))]:
            for line in part.read_text().splitlines():
                if line=='EnvironmentFile=':envfiles.clear()
                elif line.startswith('EnvironmentFile='):envfiles.append(line.split('=',1)[1].lstrip('-'))
        assert envfiles==[B+'/etc/pi-web.env','/etc/pi-web-instance/profile-catalog.env'],envfiles
        for path in list((tree/'etc/nginx/sites-available').glob('*')):
            assert '@@' not in path.read_text()
        protected=(tree/'etc/nginx/snippets/nikita-home-save.conf').read_text();assert 'auth_request' in protected and '/run/nikita-home-save.sock' in protected
        if a.http:actual(tree,cfg,seed,tmp)
    print('Fresh-instance bindings, ownership resolution, private file modes, Telegram fences, reference routes and rendered inputs: OK (offline; not a Linux installation).')
if __name__=='__main__':main()
