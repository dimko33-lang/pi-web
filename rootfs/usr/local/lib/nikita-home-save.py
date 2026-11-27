import sys, os, pathlib, tempfile, subprocess, sqlite3, datetime, shutil, glob, fcntl, stat, json, pwd, grp, platform
P=pathlib.Path
out=sys.stdout.buffer
def response(status, headers=''):
 out.write(f'HTTP/1.1 {status}\r\nCache-Control: no-store\r\nConnection: close\r\n{headers}\r\n'.encode());out.flush()
def main():
 line=sys.stdin.buffer.readline(4096); assert line.split()[:2]==[b'GET',b'/export'];
 for i in range(80):
  if sys.stdin.buffer.readline(8192) in (b'\r\n',b'\n'):break
 else:raise ValueError('headers')
 lock=open('/var/lib/nikita-home-save/lock','a');
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:response('409 Conflict');return
 os.chdir('/');config=P('/etc/nikita-home-save');registry=json.loads((config/'projects.json').read_text());roots=[p for paths in registry['projects'].values() for p in paths];roots += [p for p in registry.get('optionalRoots',[]) if os.path.lexists(p)];roots+=sorted(glob.glob('etc/systemd/system/*nikita*')+glob.glob('etc/systemd/system/tg-agent*'))
 if any(P(p).is_absolute() or '..' in P(p).parts or not os.path.lexists(p) for p in roots):raise ValueError('Missing or invalid registered path')
 with tempfile.TemporaryDirectory() as d:
  root=P(d)/'rootfs';root.mkdir();cmd=['rsync','-aHR','--no-devices','--no-specials']+['--exclude='+x for x in ['node_modules/','venv/','.venv/','__pycache__/','.npm/_cacache/','*.pyc','/var/lib/nikita-salon-history/*/*.part']]+roots+[str(root)+'/'];subprocess.run(cmd,check=True,stdout=sys.stderr);subprocess.run(cmd,check=True,stdout=sys.stderr)
  # Normalize copied SQLite databases inside private staging, never modify the live originals.
  for p in root.rglob('*'):
   if not stat.S_ISREG(p.lstat().st_mode):continue
   with p.open('rb') as f:h=f.read(16)
   if h!=b'SQLite format 3\0':continue
   for suffix in ['-wal','-journal','-shm']:
    if P(str(p)+suffix).is_symlink():raise ValueError('invalid sidecar')
   fd,tmp=tempfile.mkstemp(dir=p.parent);os.close(fd);a=sqlite3.connect(p);b=sqlite3.connect(tmp);a.backup(b);assert b.execute('pragma quick_check').fetchone()==('ok',);b.close();a.close();s=p.stat();os.chown(tmp,s.st_uid,s.st_gid);os.chmod(tmp,stat.S_IMODE(s.st_mode));os.replace(tmp,p)
   for ext in ['-wal','-shm','-journal']:P(str(p)+ext).unlink(missing_ok=True)
  for k in ['var/www/nikita-site/index.html','var/lib/nikita-publications/index.json','var/lib/nikita-live-archive/authors.json','srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent/agent_server.py']:assert (root/k).is_file()
  for k in ['etc/nikita-project-route/upstream.conf','opt/nikita-project-runtime/Dockerfile','var/lib/nikita-salon-history/index.sqlite','var/lib/nikita-salon-history/guest_dm/messages.json','etc/nginx/conf.d/nikita-salon-access.conf']:assert (root/k).is_file()
  shutil.copyfile(config/'projects.json',P(d)/'PROJECTS.json');shutil.copyfile(config/'RESTORE.md',P(d)/'RESTORE.md')
  accounts=[]
  for a in pwd.getpwall():
   if 'nikita' in a.pw_name or a.pw_name in ('curvelab-editor','pi-browser'):accounts.append(dict(name=a.pw_name,uid=a.pw_uid,gid=a.pw_gid,home=a.pw_dir,groups=[{'name':grp.getgrgid(g).gr_name,'gid':g} for g in os.getgrouplist(a.pw_name,a.pw_gid)]))
  enabled=sorted({p.name for p in P('/etc/systemd/system').glob('*.wants/*') if any(w in p.name for w in ('nikita','tg-agent','curvelab'))})
  (P(d)/'RECOVERY.json').write_text(json.dumps(dict(format=2,created=datetime.datetime.now(datetime.timezone.utc).isoformat(),os=platform.freedesktop_os_release(),architecture=platform.machine(),node=subprocess.check_output(['/opt/node22/bin/node','--version'],text=True).strip(),python=platform.python_version(),accounts=accounts,enabled=enabled,roots=roots),indent=2));(P(d)/'package-versions.tsv').write_bytes(subprocess.check_output(['dpkg-query','-W','-f=${binary:Package}\t${Version}\n']))
  name='nikita-home-' +datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.tar.gz';file=P(d)/name;subprocess.run(['tar','-czf',file,'-C',d,'rootfs','PROJECTS.json','RECOVERY.json','RESTORE.md','package-versions.tsv'],check=True);subprocess.run(['gzip','-t',file],check=True);response('200 OK',f'Content-Type: application/gzip\r\nContent-Disposition: attachment; filename="{name}"\r\nContent-Length: {file.stat().st_size}\r\n');
  with file.open('rb') as f:shutil.copyfileobj(f,out)
try:main()
except (BrokenPipeError,ConnectionResetError):pass
except Exception as e:
 print(type(e).__name__,file=sys.stderr);response('503 Service Unavailable')
