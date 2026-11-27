#!/usr/bin/env python3
"""Offline reference checks. No host paths, Telegram sessions, external accounts or providers."""
import argparse
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
from prepare import verify, bindings, stage, REPO

def fixture(schema):
    vals={}
    for i,(k,t) in enumerate(sorted(schema.items()),1):
        if t in ('derived','venv-instance'):continue
        if t=='integer':v=str(1002000000000+i)
        elif t=='host':v=k.lower().replace('_','-')+'.invalid'
        elif t.startswith('hex'):v='0'*int(t[3:])
        elif t=='secret64':v=secrets.token_hex(32)
        elif t=='access-token':v=secrets.token_urlsafe(32)
        elif t=='label':v='Example'
        else:v='example_'+str(i)
        vals[k]=v
    return vals

def check(d,schema,manifest):
    raw=fixture(schema);v=bindings(schema,raw)
    for key,value in [('OWNER_ID','0'),('PANEL_HOST','host.invalid; include bad'),('OWNER_LABEL',"User' + code"),('INSTANCE','override'),('READER_COOKIE',v['SALON_COOKIE'])]:
        try:bindings(schema,{**raw,key:value})
        except ValueError:pass
        else:raise AssertionError('Rejected input accepted: '+key)
    stage(manifest,v,d)
    d=d.resolve(strict=True)
    tg=d/'srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent'; panel=d/'srv/pi-workspaces/browser/rootfs/opt/pi-web'
    for f in d.rglob('*.py'):ast.parse(f.read_bytes(),str(f))
    for f in d.rglob('*.json'):json.loads(f.read_bytes())
    for f in [*tg.glob('media-decoder/*.cjs'),*tg.glob('mathrender/*.js'),*panel.glob('public/*.js'),*d.glob('usr/local/lib/*.cjs'),*d.glob('srv/pi-workspaces/browser/rootfs/opt/site-entry/*.mjs')]:subprocess.run(['node','--check',str(f)],check=True,stdout=subprocess.DEVNULL)
    for f in [panel/'start.sh',*d.glob('usr/local/sbin/nikita-tg-*')]:subprocess.run(['bash','-n',str(f)],check=True)
    for n in manifest['links']:
        assert (d/n).is_symlink() and (d/n).resolve().is_relative_to(d)
    assert (d/'opt/tg-agent').resolve()==tg and (d/'opt/tg-agent/agent_server.py').is_file()
    units=d/'etc/systemd/system'; ng=d/'etc/nginx';entry=(ng/'snippets/nikita-home-save.conf').read_text();assert 'auth_request' in entry and '/run/nikita-home-save.sock:/export' in entry
    assert 'agent_server.py' in (units/'tg-agent.service').read_text() and 'User=pi-browser' in (units/'pi-nikita.service.d/95-browser-admin.conf').read_text()
    for unit in ('nikita-home-save.socket','nikita-reader-door.socket','nikita-salon-history.timer','nikita-salon-piwep.timer','nikita-project-runner.socket','nikita-project-deps.socket','nikita-web.service','nikita-science.service','nikita-image.service'):
        assert (units/unit).is_file(),unit
    # Resolve first-party service entrypoints (including effective drop-ins); distro
    # executables and installed venv interpreters are separately inventoried dependencies.
    import shlex
    for unit in units.glob('*.service'):
        wd='/';cmds={}
        for f in (unit,*sorted((units/(unit.name+'.d')).glob('*.conf'))):
            for line in f.read_text().splitlines():
                k,sep,x=line.partition('=')
                if not sep:continue
                if k=='WorkingDirectory':wd=x
                if k in ('ExecStart','ExecStartPre','ExecStopPost'):
                    if not x:cmds[k]=[]
                    else:cmds.setdefault(k,[]).append(shlex.split(x))
        for group in cmds.values():
            for argv in group:
                for word in argv:
                    if word.endswith(('.py','.ts','.mjs','.cjs')):
                        name=(d/word.lstrip('/')) if word.startswith('/') else (d/wd.lstrip('/')/word)
                        assert name.is_file(),(unit.name,word)
    for broker in ('gacrux','circle','heygen'):
        assert (units/('pi-web-'+broker+'-'+v['INSTANCE']+'.socket')).is_file()
    for reader in ('debri','lightcone'):assert (d/'opt/nikita-reader-ui'/(reader+'.css')).is_file()
    for shell in ('index.html','app.js','lc-index.html','lc-app.js'):assert (d/'var/lib/nikita-live-archive'/shell).is_file()
    policy=json.loads((tg/'tool-policy.json').read_bytes()); assert {'web_search','web_read','lightcone_archive','debri_archive','science','edit_image','send_article'}<=set(policy['common']) and 'manage_access' in policy['owner'] and 'manage_access' not in policy['guest']
    import runpy,sys
    sys.dont_write_bytecode=True
    roles=runpy.run_path(str(tg/'tool_policy.py')); role=roles['role_for']; tools=roles['tools_for']; owner=int(v['OWNER_ID']); public=-int(v['PROJECT_PEER']); lc=-int(v['LC_PEER']); lab=-int(v['LAB_PEER']); debri=(-int(v['DEBRI_PEER']),-int(v['DEBRI_CHANNEL']))
    for uid,channel,actor,expected in [(owner,False,owner,'owner'),(owner+99,False,owner+99,'guest'),(-public,True,owner,'channel_owner'),(-public,True,owner+99,'channel'),(-lab,True,owner,'public_research'),(-lc,True,owner,'lightcone')]:
        assert role(uid,channel,actor,owner,public,lc,debri,lab)==expected
        assert ('manage_access' in tools(expected)) == (expected=='owner')
    addr=runpy.run_path(str(tg/'circle_command.py')); assert [addr['name_format'](x) for x in ('Никита, привет','Ника, привет','Ники, привет')]==['profile','voice','circle']
    assert addr['circle_request'](peer=lc,demo_peers=(public,),text='/circle Hi',incoming=True,is_group=True) is None
    import io,wave
    worker=runpy.run_path(str(d/'etc/pi-web-speech'/v['INSTANCE']/'worker.py'))
    for preset in ('gacrux','gacrux-poem','charon-elder'):
        seen=[]
        def provider(request,**kw):
            seen.append(json.loads(request.data));return io.BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'inlineData':{'mimeType':'audio/L16;rate=24000','data':'AAA='}}]}}]}).encode())
        audio=worker['render']('Только строка.', 'fixture',provider,preset=preset)
        with wave.open(io.BytesIO(audio)) as wav:assert wav.getframerate()==24000
        assert seen[0]['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName']==('Charon' if preset=='charon-elder' else 'Gacrux')
        assert seen[0]['contents'][0]['parts'][0]['text'].endswith('Только строка.')
    assert 'gacrux-poem' in (tg/'spoken_reply.py').read_text() and 'gacrux-poem' in (d/'etc/pi-web-speech'/v['INSTANCE']/'worker.py').read_text()
    assert '/go/debri' in (ng/'sites-available/panel-instance-site-acme').read_text()
    for f in d.rglob('*'):
        if f.is_file() and not f.is_symlink():assert not re.search(rb'@@[A-Z][A-Z_0-9]*@@',f.read_bytes()),f
    card=(d/'var/www/pi-web-card/home.html').read_text();csp=(ng/'sites-available/instance-site-reader').read_text()
    for script in re.findall(r'<script\b[^>]*>(.*?)</script>',card,re.I|re.S):
        if script.strip():assert 'sha256-'+base64.b64encode(hashlib.sha256(script.encode()).digest()).decode() in csp,'Rendered landing page CSP no longer matches'
    return panel
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fixture-dir',type=Path,help='Keep an explicitly synthetic local tree in this new folder (never deploy it)');a=p.parse_args();m,s=verify()
    with tempfile.TemporaryDirectory() as tmp:
        panel=check(a.fixture_dir or Path(tmp)/'fixture',s,m)
        print('Verified actual sources, offline assembly, Python/JS syntax, credential gates, native role policy, routing, broker wiring and landing CSP. No services started.')
