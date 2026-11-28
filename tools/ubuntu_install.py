#!/usr/bin/env python3
"""Install the reference deployment on an EMPTY Ubuntu 24.04 x86_64 VPS, as root."""
import argparse, fcntl, grp, hashlib, http.client, json, os, platform, pwd, re, shutil, socket, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path as P
from install_config import APP,B,DATA,META,RELEASE,STATE,TG,catalog,domain_name,new_instance,seeds
from prepare import REPO,bindings,load,stage,verify
from pack_release import selected

VERSION='0.14.2'; S=P(STATE); CL='/srv/nikita-projects/workspace'; MOUNT='srv-nikita\\x2dprojects-workspace.mount'; NODE='v22.23.4'; ENV={**os.environ,'PATH':'/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','DEBIAN_FRONTEND':'noninteractive','PIP_DISABLE_PIP_VERSION_CHECK':'1','npm_config_update_notifier':'false'}
DEFER={'tg-agent.service','nikita-salon-history.timer','nikita-salon-piwep.timer'}

def run(*argv,env=None,cwd=None,out=False):
    return subprocess.run([str(i) for i in argv],env=env or ENV,cwd=cwd,check=True,stdout=subprocess.PIPE if out else None,text=True).stdout

def uid(n):return int(n) if n.isdigit() else pwd.getpwnam(n).pw_uid
def gid(n):return int(n) if n.isdigit() else grp.getgrnam(n).gr_gid

def directory(path,mode=0o755,user='root',group='root'):
    p=P(path);p.mkdir(mode=mode,parents=True,exist_ok=True)
    if p.is_symlink() or not p.is_dir():raise ValueError('Unexpected directory: '+str(p))
    os.chown(p,uid(user),gid(group));p.chmod(mode);return p

def write(p,data,mode=0o600,user='root',group='root'):
    p=P(p);p.parent.mkdir(parents=True,exist_ok=True)
    fd,t=tempfile.mkstemp(dir=p.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(data if isinstance(data,bytes) else data.encode())
        os.chown(t,uid(user),gid(group));os.chmod(t,mode);os.replace(t,p)
    finally:P(t).unlink(missing_ok=True)

def sub(s,v):return re.sub(r'@@([A-Z_0-9]+)@@',lambda m:v[m[1]],s)

def preflight():
    if os.geteuid()!=0 or platform.machine()!='x86_64' or not P('/run/systemd/system').is_dir():raise ValueError('Requires root, systemd and Ubuntu 24.04 x86_64')
    osrel=dict(line.split('=',1) for line in P('/etc/os-release').read_text().splitlines() if '=' in line)
    if osrel.get('ID','').strip('"')!='ubuntu' or osrel.get('VERSION_ID','').strip('"')!='24.04':raise ValueError('Requires Ubuntu 24.04')
    if S.exists():
        if S.is_symlink() or S.stat().st_uid or S.stat().st_mode & 0o077 or not (S/'version').is_file() or (S/'version').read_text().strip()!=VERSION:raise ValueError('Unrecognized installer state; stopping')
        return
    if len(os.sched_getaffinity(0))<2:raise ValueError('At least two CPUs required for the application sandbox')
    if shutil.disk_usage('/').free<18*1024**3:raise ValueError('At least 18 GiB free on the root volume required')
    reserved=[RELEASE,CL,'/srv/pi-workspaces','/srv/nikita-projects','/root/PiWebRuntime','/etc/nginx','/etc/letsencrypt','/etc/pi-web-instance','/usr/local/bin/node','/usr/local/bin/pi','/var/lib/docker','/etc/curvelab-editor.env']
    manifest=load(META/'source.json');reserved += ['/'+k.split('/')[0]+'/'+k.split('/')[1] for k in manifest['files'] if k.startswith('opt/') and '@@' not in k];reserved+=['/opt/node22','/opt/nikita-web-venv','/opt/nikita-web-browsers','/opt/pi-browsers'];reserved+=['/'+k for k in (*manifest['files'],*manifest['links']) if '@@' not in k]
    reserved += ['/var/lib/nikita-project-sandbox','/var/lib/pi-browser-admin','/var/lib/nikita-home-save','/etc/pi-web-speech','/opt/nikita-circle-reserve','/etc/nikita-project-route','/var/lib/nikita-publications','/var/lib/nikita-salon-history','/var/lib/nikita-salon-piwep','/var/lib/nikita-science','/var/lib/nikita-image']
    reserved += [str(p) for pattern in ('/opt/pi-web-*','/var/lib/nikita-*','/var/www/pi-web-*','/home/*/PiWebRuntime','/etc/systemd/system/*nikita*','/etc/systemd/system/pi-web-*') for p in P('/').glob(pattern[1:])]
    collisions=sorted(set(p for p in reserved if os.path.lexists(p)))
    if collisions:raise ValueError('Not a clean host. Existing path preserved: '+collisions[0])
    for n in load(META/'platform.json')['users']:
        try:pwd.getpwnam(n)
        except KeyError:continue
        raise ValueError('Existing service account: '+n)
    listening=run('ss','-ltnH',out=True)
    if any(line.split()[3].rsplit(':',1)[-1] in ('80','443','5080','5670','5690') for line in listening.splitlines()):raise ValueError('Required port already occupied')

def packages():
    run('systemctl','mask','--runtime','nginx.service')
    run('apt-get','-o','DPkg::Lock::Timeout=120','update');run('apt-get','-o','DPkg::Lock::Timeout=120','install','-y','nginx','certbot','docker.io','python3-venv','rsync','acl','sudo','bubblewrap','polkitd','e2fsprogs','ca-certificates','curl','openssl','iproute2','build-essential','python3-dev','libvulkan1','git','xz-utils');run('systemctl','unmask','--runtime','nginx.service');run('systemctl','disable','--now','nginx');run('systemctl','enable','--now','docker')

def accounts():
    if not any(g.gr_name=='pi-tools' for g in grp.getgrall()):run('groupadd','--system','pi-tools')
    for n,rec in load(META/'platform.json')['users'].items():
        if n=='nikita-reader-door':continue  # Allocated by DynamicUser.
        try:pwd.getpwnam(n)
        except KeyError:run('useradd','--system','--user-group','--no-create-home','--home-dir',rec['home'],'--shell','/usr/sbin/nologin',n)
    run('usermod','-a','-G','pi-tools','pi-nikita')

def volume():
    image=directory('/var/lib/nikita-project-sandbox',0o700)/'project.ext4';directory(CL,0o700)
    if not image.exists():
        temp=image.with_suffix('.new');temp.unlink(missing_ok=True)
        with temp.open('xb') as f:f.truncate(3*1024**3)
        run('mkfs.ext4','-q','-F',temp);temp.replace(image)
    write('/etc/systemd/system/'+MOUNT,(REPO/'rootfs/etc/systemd/system'/MOUNT).read_bytes(),0o644);run('systemctl','daemon-reload');run('systemctl','enable','--now',MOUNT)
    if not os.path.ismount(CL):raise ValueError('Project workspace mount failed')

def principal(name,info):
    if info['user'] and info['group']:return info
    if name.startswith(CL[1:]+'/work/') and info['user']==info['group']=='':return {**info,'user':'1000','group':'1000'}
    raise ValueError('No deployment owner for '+name)

def copy_payload(v):
    mf,_=verify();acl=load(META/'ownership.json')
    with tempfile.TemporaryDirectory(dir=S) as t:
        tree=P(t)/'tree';stage(mf,v,tree)
        for n,info in sorted(acl['dirs'].items(),key=lambda p:p[0].count('/')):
            info=principal(n,info);p=P('/')/sub(n,v)
            if not p.exists():directory(p,int(info['mode'],8),info['user'],info['group'])
        cpus=max(1,min(4,len(os.sched_getaffinity(0)),int(run('docker','info','--format','{{.NCPU}}',out=True))))
        for n,item in mf['files'].items():
            dest=P('/')/sub(n,v);info=principal(n,acl['files'][n]);data=(tree/sub(n,v)).read_bytes()
            if n.startswith('etc/nginx/sites-available/'):
                data=re.sub(rb'/etc/letsencrypt/live/[^/\s]+/',b'/etc/letsencrypt/live/pi-web-instance/',data)
            if n=='opt/nikita-science/worker.py':
                for arg in (b'--cpus=4',b'OPENBLAS_NUM_THREADS=4',b'OMP_NUM_THREADS=4'):
                    if data.count(arg)!=1:raise ValueError('Unexpected science resource contract')
                    data=data.replace(arg,arg[:-1]+str(cpus).encode())
            write(dest,data,int(item['mode'],8),info['user'],info['group'])
        for n,target in mf['links'].items():
            p=P('/')/sub(n,v);to=sub(target,v);p.parent.mkdir(parents=True,exist_ok=True)
            if p.is_symlink() and os.readlink(p)==to:continue
            p.symlink_to(to)
    default=P('/etc/nginx/sites-enabled/default')
    if default.is_symlink() and default.resolve()==P('/etc/nginx/sites-available/default'):default.unlink()
    write('/etc/nginx/conf.d/01-instance-hostnames.conf','server_names_hash_bucket_size 256;\n',0o644)
    P(CL).chmod(0o700)  # Container UID 1000 is not an authority on the host.
    directory(CL+'/work',0o700,'1000','1000');directory('/etc/nikita-project-route',0o750,'root','www-data')

def init_state(cfg):
    directory('/etc/pi-web-instance',0o750,'root','pi-nikita');directory('/etc/pi-web-instance/legacy-articles',0o700)
    for p in [B+'/root',B+'/root/.pi/agent',APP+'/sessions',APP+'/data',B+'/opt/projects']:directory(p,0o700,'pi-browser','pi-browser')
    directory(B+'/etc',0o750,'root','pi-browser');directory(DATA,0o2770,'pi-nikita','pi-nikita')
    # The Telegram metadata reader is intentionally in its own workspace: no access to B or browser authorization.
    for name in ('models.json','server/pi-context-reader.mjs'):
        write(P(DATA).parent/name,(P(APP)/name).read_bytes(),0o644)
    for suffix in ('root','root/.pi','root/.pi/agent'):directory('/srv/pi-workspaces/nikita/rootfs/'+suffix,0o700,'pi-nikita','pi-nikita')
    for n in ('users','workspaces','home','home/.pi/agent','backups','last-good','testing','pi-sessions'):directory(TG+'/'+n,0o700,'pi-nikita','pi-nikita')
    for n in ('var/lib/nikita-publications','var/lib/nikita-salon-history','var/lib/nikita-salon-piwep','var/lib/nikita-live-archive/messages','var/www/pi-web-public','srv/nikita-projects/static/public'):directory('/'+n,0o755,'pi-nikita','pi-nikita')
    for k in ('ARRI_PEER','PROJECT_PEER'):directory(TG+'/workspaces/'+cfg['bindings'][k]+'/site',0o700,'pi-nikita','pi-nikita')
    for p in ('/opt/nikita-lightcone-archive','/opt/nikita-debri-archive','/var/www/instance-site-acme','/var/lib/nikita-science/work','/var/lib/pi-browser-admin','/var/lib/pi-browser-admin/jobs','/var/lib/nikita-home-save'):directory(p,0o700 if 'admin' in p or 'save' in p else 0o755)
    for n in ('data','.snapshots'):directory(CL+'/live-data/'+n,0o700,'1000','1000')
    for p,(text,mode,u,g) in seeds(cfg).items():
        if 'salon-history/' in p or 'salon-piwep/' in p:directory(P(p).parent,0o755,'pi-nikita','pi-nikita')
        if not P(p).exists():write(p,text,mode,u,g)
    db=P('/var/lib/nikita-salon-history/index.sqlite');conn=sqlite3.connect(db);conn.executescript('CREATE TABLE IF NOT EXISTS items(peer INTEGER,id INTEGER,section TEXT,stamp INTEGER,payload TEXT,original TEXT,PRIMARY KEY(peer,id)); CREATE TABLE IF NOT EXISTS cursors(peer INTEGER PRIMARY KEY,id INTEGER); CREATE INDEX IF NOT EXISTS by_section ON items(section,stamp);');conn.close();os.chown(db,uid('pi-nikita'),gid('pi-nikita'));db.chmod(0o600)
    for p in ['/srv/pi-workspaces/nikita',TG]:run('setfacl','-m','u:pi-browser:--x',p)
    run('setfacl','-m','u:pi-browser:r--',TG+'/working-rules.md');run('setfacl','-Rm','u:pi-browser:rwX',DATA);run('setfacl','-m','d:u:pi-browser:rwx,d:u:pi-nikita:rwx',DATA)
    run('visudo','-cf','/etc/sudoers.d/pi-browser-launch')

def runtimes(v):
    archive=S/'node.tar.gz';run('curl','-fsSL','--retry','3','https://nodejs.org/dist/'+NODE+'/node-'+NODE+'-linux-x64.tar.gz','-o',archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!='b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406':raise ValueError('Node checksum mismatch')
    directory('/opt/node22');run('tar','xzf',archive,'--no-same-owner','--strip-components=1','-C','/opt/node22')
    for p in ['/opt/pi-web-runtime',APP,TG+'/mathrender',TG+'/media-decoder']:
        run('npm','ci','--no-audit','--no-fund','--ignore-scripts',cwd=p)
    cli='/opt/pi-web-runtime/node_modules/.bin/pi'
    if run(cli,'--version',out=True).strip()!=load(META/'platform.json')['pi']:raise ValueError('Installed Pi version differs from the release pin')
    p=P('/usr/local/bin/pi')
    if not p.exists():p.symlink_to(cli)
    run('node','node_modules/playwright-core/cli.js','install','--with-deps','chromium',cwd=APP,env={**ENV,'PLAYWRIGHT_BROWSERS_PATH':'/opt/pi-browsers'})
    chromium=run('node','-p',"require('playwright-core').chromium.executablePath()",cwd=APP,env={**ENV,'PLAYWRIGHT_BROWSERS_PATH':'/opt/pi-browsers'},out=True).strip()
    if not P(chromium).is_file():raise ValueError('Chromium binary not installed')
    write('/etc/systemd/system/pi-nikita.service.d/99-chromium.conf','[Service]\nEnvironment=CHROMIUM_PATH='+chromium+'\n',0o644)
    deps=load(META/'dependencies.json');hey='/opt/pi-web-heygen-'+v['INSTANCE'];venvs={'image':'/opt/nikita-image/venv','web':'/opt/nikita-web-venv','telegram':TG+'/venv','circle':'/opt/nikita-circle-reserve/venv','heygen':hey+'/venv'}
    for name,dest in venvs.items():
        run('/usr/bin/python3','-m','venv',dest);req=S/(name+'.lock');write(req,''.join(k+'=='+val+'\n' for k,val in deps['packages.'+name].items() if k!='pip'));run(dest+'/bin/python','-m','pip','install','--no-input','-r',req)
    run('/opt/nikita-web-venv/bin/python','-m','playwright','install','--with-deps','chromium',env={**ENV,'PLAYWRIGHT_BROWSERS_PATH':'/opt/nikita-web-browsers'})
    for n in ('voice_assets.py','speech_assets.py'):run(TG+'/venv/bin/python','-I','-B',str(REPO/'rootfs'/TG[1:]/n))
    ff=S/'ffmpeg.lock';write(ff,'imageio-ffmpeg==0.6.0 --hash=sha256:c7e46fcec401dd990405049d2e2f475e2b397779df2519b544b8aab515195282\n');run(hey+'/venv/bin/python','-m','pip','install','--no-deps','--require-hashes','-r',ff);binary=run(hey+'/venv/bin/python','-c','import imageio_ffmpeg as f;print(f.get_ffmpeg_exe())',out=True).strip();shutil.copy2(binary,hey+'/ffmpeg')
    for p,meta in load(META/'binaries.json').items():
        path=P(sub(p,v));h=hashlib.sha256()
        with path.open('rb') as f:
            while chunk:=f.read(1024*1024):h.update(chunk)
        if h.hexdigest()!=meta['sha256']:raise ValueError('Installed binary mismatch: '+str(path))
    science='pi-web-science:'+VERSION;run('docker','build','-t',science,'/opt/nikita-science');write('/opt/nikita-science/image-id',run('docker','image','inspect','--format','{{.Id}}',science,out=True),0o644)
    run('docker','build','-t','nikita-project-runtime:stage','/opt/nikita-project-runtime');run('systemctl','daemon-reload')

def certificates(v):
    names=sorted({v[k] for k in ('PANEL_HOST','SITE_HOST','SITE_WWW','PUBLIC_HOST','EDITOR_HOST','EDITOR_WWW','ARRI_HOST')});cert=P('/etc/letsencrypt/live/pi-web-instance');tls=os.environ.get('PI_WEB_TLS','acme')
    if tls not in ('acme','self-signed'):raise ValueError('PI_WEB_TLS must be acme or self-signed')
    if tls=='self-signed':
        directory(cert,0o700);run('openssl','req','-x509','-newkey','rsa:3072','-nodes','-days','30','-subj','/CN='+v['PANEL_HOST'],'-addext','subjectAltName='+','.join('DNS:'+n for n in names),'-keyout',cert/'privkey.pem','-out',cert/'fullchain.pem');(cert/'privkey.pem').chmod(0o600)
    else:
        # Use the final webroot for both issuance and renewal. No panel routes until validation.
        acme=S/'acme-nginx.conf';write(acme,'pid /run/pi-web-acme.pid;\nuser www-data;\nevents {}\nhttp { server { listen 80; listen [::]:80; location ^~ /.well-known/acme-challenge/ { root /var/www/instance-site-acme; } location / { return 404; } } }\n')
        with subprocess.Popen(['/usr/sbin/nginx','-c',str(acme),'-g','daemon off;'],env=ENV) as front:
            try:
                for _ in range(40):
                    if front.poll() is not None:raise RuntimeError('ACME HTTP listener failed')
                    try:
                        with socket.create_connection(('127.0.0.1',80),timeout=1):break
                    except OSError:time.sleep(.1)
                args=['certbot','certonly','--webroot','-w','/var/www/instance-site-acme','--non-interactive','--agree-tos','--register-unsafely-without-email','--keep-until-expiring','--cert-name','pi-web-instance']
                for n in names:args.extend(['-d',n])
                run(*args)
            finally:front.terminate()
        write('/etc/letsencrypt/renewal-hooks/deploy/pi-web-nginx','#!/bin/sh\n/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx\n',0o755)
    run('nginx','-t')

def health(cfg,https):
    v=cfg['bindings']; host=v['PANEL_HOST'];url=('https://'+host if https else 'http://127.0.0.1:5670')+'/profiles';args=['curl','-sS','--noproxy','*','--max-time','4','-o','/dev/null','-w','%{http_code}']
    if https:args+=['--cacert','/etc/letsencrypt/live/pi-web-instance/fullchain.pem','--resolve',host+':443:127.0.0.1']
    for _ in range(25):
        try:status=run(*args,url,out=True)
        except subprocess.CalledProcessError:status='000'
        if status=='401':break
        if status.startswith('2'):raise RuntimeError('Panel accepted an anonymous request')
        time.sleep(1)
    else:raise RuntimeError('Panel did not present its expected authentication boundary: '+status)
    entry=http.client.HTTPConnection('127.0.0.1',5690,timeout=10);entry.request('GET','/?key='+cfg['entryKey']);r=entry.getresponse();cookies=r.headers.get_all('set-cookie') or [];assert r.status==303 and any(c.startswith('cl_sid=') for c in cookies),'Entry login failed';entry.close()
    conn=http.client.HTTPConnection('127.0.0.1',5670,timeout=5);conn.request('GET','/api/conversation-profiles',headers={'Cookie':cookies[0].split(';')[0]});r=conn.getresponse();assert r.status==200 and len(json.load(r)['profiles'])==len(catalog(cfg)),'Profile catalog unavailable';conn.close()

def activate(cfg,v):
    enabled=[sub(n,v) for n,state in load(META/'platform.json')['unitStates'].items() if state=='enabled' and n not in DEFER]
    run('systemctl','daemon-reload');run('systemctl','enable','--now',*enabled);health(cfg,False);run('systemctl','enable','--now','nginx');health(cfg,True)
    for n in enabled:run('systemctl','is-active','--quiet',n)
    for host,path,allowed in [(v['EDITOR_HOST'],'/',('404',)),(v['SITE_HOST'],'/nikita/data/index.json',('401','403')),(v['PANEL_HOST'],'/api/project/download/source',('401','403'))]:
        status=run('curl','-sS','--noproxy','*','--max-time','8','--cacert','/etc/letsencrypt/live/pi-web-instance/fullchain.pem','--resolve',host+':443:127.0.0.1','-o','/dev/null','-w','%{http_code}','https://'+host+path,out=True)
        if status not in allowed:raise RuntimeError('Unexpected fresh-host route status: '+path+' ('+status+')')
    write(S/'access.txt','https://'+v['PANEL_HOST']+'/?key='+cfg['entryKey']+'\n');directory('/root/PiWebRuntime/bin',0o700);write('/root/PiWebRuntime/bin/nikita-telegram','#!/bin/sh\nexec systemctl status tg-agent --no-pager\n',0o700)

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--plan',action='store_true');a=ap.parse_args();mf,sc=verify()
    if a.plan:print('Ubuntu 24.04 x86_64, clean host, root/systemd: guards → accounts → ext4 workspace → reference payload → private instance seeds → locked dependencies and Docker images → TLS → authenticated service checks. No Telegram login or provider request.');return
    os.umask(0o022);preflight();ssh=os.environ.get('SSH_CONNECTION','').split()
    if not S.exists():
        ip=os.environ.get('PI_WEB_PUBLIC_IP') or (ssh[2] if len(ssh)==4 else '')
        if not ip and not os.environ.get('PI_WEB_DOMAIN'):
            route=run('ip','-4','route','get','1.1.1.1',out=True).split()
            if 'src' in route:ip=route[route.index('src')+1]
        domain=domain_name(os.environ.get('PI_WEB_DOMAIN',''),ip);directory(S,0o700);write(S/'version',VERSION+'\n');write(S/'domain',domain+'\n')
    with (S/'install.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if not (S/'inputs.json').exists():
            override=None
            if os.environ.get('PI_WEB_BINDINGS'):
                path=P(os.environ['PI_WEB_BINDINGS'])
                if path.is_symlink() or not path.is_file() or path.stat().st_uid or path.stat().st_mode & 0o077:raise ValueError('PI_WEB_BINDINGS must be a root-owned private regular file')
                override=load(path)
            cfg=new_instance((S/'domain').read_text().strip(),override);write(S/'inputs.json',json.dumps(cfg))
        cfg=load(S/'inputs.json');v=bindings(sc,cfg['bindings']);print('Installing Pi Web '+VERSION+' for '+v['PANEL_HOST'],flush=True)
        if not P(RELEASE).exists():
            with tempfile.TemporaryDirectory(dir='/opt') as tmp:
                copy=P(tmp)/'release'
                for n in selected(mf):write(copy/n,(REPO/n).read_bytes(),0o644)
                copy.rename(RELEASE)
        for n,fn in [('packages',packages),('accounts',accounts),('mount',volume),('payload',lambda:copy_payload(v)),('private-seeds',lambda:init_state(cfg)),('dependencies',lambda:runtimes(v)),('certificate',lambda:certificates(v)),('activation',lambda:activate(cfg,v))]:
            marker=S/('done-'+n)
            if marker.exists():continue
            print('Pi Web: '+n,flush=True)
            try:fn()
            except BaseException:
                if n=='activation':subprocess.run(['systemctl','disable','--now','nginx'])
                print('Stopped at '+n+'; no success marker. Correct the error and rerun the SAME installer.',file=sys.stderr);raise
            write(marker,VERSION+'\n')
        health(cfg,True);print('Private panel link (root-only copy: '+str(S/'access.txt')+'):\n'+(S/'access.txt').read_text().strip());print('Telegram is not enrolled. Use separate provider and Telegram credentials; never run a copied session on two hosts.')
if __name__=='__main__':main()
