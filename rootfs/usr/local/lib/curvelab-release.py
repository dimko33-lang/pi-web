"""Fixed-target release operations. Repository code runs only in the project container."""
import os,shutil,subprocess,tempfile,time
from pathlib import Path
BASE=Path('/srv/nikita-projects/curvelab'); WORK=BASE/'work'; ROUTES=Path('/etc/curvelab-route'); IMAGE='curvelab-project-runtime:stage'; D='/usr/bin/docker'
def call(args,check=True):return subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=28,check=check)
def names(slot):return 'cl-site-'+slot,'cl-ingress-'+slot
def url(slot):return 'http://127.0.0.1:5080' if slot=='original' else 'http://unix:'+str(ROUTES/slot/'http.sock')+':'
def toggle(slot):
    file=ROUTES/'upstream.conf';old=file.read_bytes();tmp=ROUTES/'next';tmp.write_text('proxy_pass '+url(slot)+';\n');tmp.chmod(0o644);os.replace(tmp,file)
    try:call(['/usr/sbin/nginx','-t']);call(['/usr/bin/systemctl','reload','nginx'])
    except Exception:file.write_bytes(old);raise

def health(slot,expected):
    unix=[] if slot=='original' else ['--unix-socket',str(ROUTES/slot/'http.sock')];target='http://127.0.0.1:5080/' if not unix else 'http://localhost/'
    for _ in range(30):
        r=call(['/usr/bin/curl','--max-time','1','-s','-o','/dev/null','-w','%{http_code}',*unix,target],False)
        if r.stdout==str(expected).encode():return
        time.sleep(.2)
    raise ValueError('Candidate did not become healthy; the live route was not changed')

def release(action):
    if not os.path.ismount(BASE):raise ValueError('Project volume not mounted')
    route=(ROUTES/'upstream.conf').read_text().strip();current=next((s for s in ['original','a','b','c'] if route=='proxy_pass '+url(s)+';'),None)
    if current is None:raise ValueError('Unexpected routing configuration')
    prev=ROUTES/'previous';previous=prev.read_text().strip() if prev.exists() else 'original'
    if action=='rollback':
        if previous not in ('original','a','b','c') or previous==current:raise ValueError('No previous release')
        health(previous,410 if (ROUTES/('withdrawn-'+previous)).exists() else 200);toggle(previous);prev.write_text(current);return {'live':previous,'rolled_back':True}
    slot=next(s for s in ('a','b','c') if s not in (current,previous));site,relay=names(slot);release_dir=BASE/('release-'+slot)
    for name in (relay,site):call([D,'rm','-f',name],False)
    if release_dir.exists():shutil.rmtree(release_dir)
    release_dir.mkdir(mode=0o755)
    if action!='withdraw':
        if not (WORK/'package.json').is_file():raise ValueError('No package.json to publish')
        call(['/usr/bin/cp','-a','--reflink=auto','--',str(WORK)+'/.',str(release_dir)])
        for key in ('data','.snapshots'):
            child=release_dir/key
            if child.is_symlink() or (child.exists() and not child.is_dir()):raise ValueError('Invalid runtime data directory')
            child.mkdir(exist_ok=True)
    shared=BASE/'live-data';shared.mkdir(exist_ok=True)
    for key in ('data','.snapshots'):
        p=shared/key;p.mkdir(exist_ok=True);os.chown(p,1000,1000)
    common=['--restart','unless-stopped','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--user','1000:1000','--pids-limit','128','--log-opt','max-size=2m','--log-opt','max-file=2','--tmpfs','/tmp:size=64m']
    args=[D,'run','-d','--name',site,'--network','none','--memory','640m','--cpus','1.5',*common]
    if action=='withdraw':args += [IMAGE,'node','-e',"require('node:http').createServer((q,r)=>{r.writeHead(410);r.end('Project offline')}).listen(5080,'127.0.0.1')"]
    else:args+=['--env-file','/etc/curvelab-editor.env','-e','HOME=/tmp','-w','/project','-v',str(release_dir)+':/project:ro','-v',str(shared/'data')+':/project/data','-v',str(shared/'.snapshots')+':/project/.snapshots',IMAGE,'npm','start']
    try:
        call(args);path=ROUTES/slot;path.mkdir(exist_ok=True);os.chown(path,1000,1000);path.chmod(0o755)
        call([D,'run','-d','--name',relay,'--network','container:'+site,'--memory','128m','--cpus','0.5',*common,'-v',str(path)+':/ingress','-v','/usr/local/lib/curvelab-http-relay.cjs:/relay.cjs:ro',IMAGE,'node','/relay.cjs']);health(slot,410 if action=='withdraw' else 200)
        if action=='check':
            for name in (relay,site):call([D,'rm','-f',name],False)
            return {'candidate':'healthy','published':False}
        toggle(slot)
    except Exception:
        for name in (relay,site):call([D,'rm','-f',name],False)
        raise
    marker=ROUTES/('withdrawn-'+slot)
    if action=='withdraw':marker.touch()
    else:marker.unlink(missing_ok=True)
    prev.write_text(current);return {'live':slot,'url':'https://@@EDITOR_HOST@@/','withdrawn':action=='withdraw'}
