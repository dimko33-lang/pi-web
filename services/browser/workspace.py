#!/usr/bin/python3 -I
"""Stock root-owned controller only. No setuid bit, sudo rule, SSH key or privileged socket."""
import datetime
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys

BASE = Path('/root/PiWebRuntime')
APP = BASE / 'app'
PI = BASE / 'pi-cli/node_modules/.bin/pi'
STATE = Path('/var/lib/pi-web-workspace')


def main():
    if os.geteuid() != 0 or not (STATE / 'managed-v1').is_file(): raise ValueError('Workspace not installed')
    user = pwd.getpwnam('pi-web-workspace')
    if not user.pw_uid or not user.pw_gid: raise ValueError('Invalid workspace user')
    node, command, *args = sys.argv[1:]
    node_root = Path(node).resolve().parent.parent
    if node_root.parent != BASE or not re.fullmatch(r'node-v[0-9.]+-linux-(x64|arm64)', node_root.name): raise ValueError('Unknown Node runtime')
    # Only these host paths are exposed. Root home, application data, control sockets,
    # host processes, Telegram state and the privileged controller environment are absent.
    broker = '/usr/bin/bwrap' if Path('/usr/bin/bwrap').is_file() else str(STATE/'bwrap')
    b = [broker,'--die-with-parent','--unshare-pid','--unshare-ipc','--unshare-uts',
         '--ro-bind','/usr','/usr','--dev','/dev','--proc','/proc','--tmpfs','/tmp']
    for name in ('bin','lib','lib64','sbin'):
        p = Path('/')/name
        if p.is_symlink(): b += ['--symlink',os.readlink(p),str(p)]
        elif p.is_dir(): b += ['--ro-bind',str(p),str(p)]
    for name in ('ssl/certs','ssl/openssl.cnf','ca-certificates','resolv.conf','hosts','nsswitch.conf','passwd','group','ld.so.cache','alternatives'):
        p = Path('/etc')/name
        if p.exists(): b += ['--ro-bind',str(p.resolve()),str(p)]
    b += ['--ro-bind',str(node_root),'/opt/node','--ro-bind',str(BASE/'pi-cli'),'/opt/pi',
          '--ro-bind',str(APP/'server'),'/opt/app/server','--ro-bind',str(APP/'node_modules'),'/opt/app/node_modules',
          '--ro-bind',str(APP/'package.json'),'/opt/app/package.json','--bind',str(STATE/'work'),'/workspace',
          '--dir','/home','--dir','/home/agent','--dir','/home/agent/.pi','--dir','/home/agent/.pi/agent']
    # Use a fresh private writable Pi home each turn; never load workspace-provided config as host root.
    def blob(content, dest):
        fd=os.memfd_create('pi-turn-data',0);os.set_inheritable(fd,True);os.write(fd,content);os.lseek(fd,0,0)
        b.extend(['--perms','0444','--file',str(fd),dest])
    if command == '/usr/bin/id' and args == ['-u']:
        launch=[command,*args]
    else:
        if not PI.exists() or Path(command).resolve()!=PI.resolve(): raise ValueError('Expected the installer-managed Pi CLI')
        launch=['/opt/node/bin/node','/opt/pi/'+str(PI.resolve().relative_to(BASE/'pi-cli'))]
        if args not in (['--version'], ['--help']):
            if not args or args[0]!='-p': raise ValueError('Expected a browser turn')
            # The final argument is the prompt, not part of the trusted option list.
            flags=args[:-1];prompt=args[-1]; model=flags[flags.index('--model')+1]; provider=model.split('/',1)[0]
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]*',provider): raise ValueError('Invalid provider')
            # Pi itself resolves/refreshes credentials in the original store. Grant this turn
            # only the selected provider credential, not a writable clone of root's auth store.
            auth=subprocess.run([str(PI),'auth','print-api-key','--model',model],stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=APP,timeout=60,
                                env={**os.environ,'PATH':str(node_root/'bin')+':/usr/bin:/bin'})
            if auth.returncode or not auth.stdout.strip(): raise ValueError('Connect the selected provider in Pi first')
            blob(json.dumps({provider:{'type':'api_key','key':auth.stdout.decode().strip()}}).encode(),'/home/agent/.pi/agent/auth.json')
            # Only the chosen provider/model's transport metadata, not another provider's
            # headers, credentials, extensions, MCP servers or executable settings.
            agent_dir=Path(os.environ.get('PI_CODING_AGENT_DIR') or Path.home()/'.pi/agent')
            model_id=model.split('/',1)[-1]
            def model_fields(m):
                return {k:v for k,v in m.items() if k in ('id','name','api','baseUrl','provider','reasoning','input','cost','contextWindow','maxTokens','compat')}
            custom=agent_dir/'models.json'
            if custom.is_file():
                spec=json.loads(custom.read_text()).get('providers',{}).get(provider,{})
                dest={k:v for k,v in spec.items() if k in ('baseUrl','api','authHeader')}
                choices=[model_fields(m) for m in spec.get('models',[]) if m.get('id')==model_id]
                if choices: dest['models']=choices
                if dest: blob(json.dumps({'providers':{provider:dest}}).encode(),'/home/agent/.pi/agent/models.json')
            discovery=agent_dir/'models-store.json'
            if discovery.is_file():
                spec=json.loads(discovery.read_text()).get(provider,{})
                choices=[model_fields(m) for m in spec.get('models',[]) if isinstance(m,dict) and m.get('id')==model_id]
                if choices: blob(json.dumps({provider:{'models':choices,'checkedAt':spec.get('checkedAt',0)}}).encode(),'/home/agent/.pi/agent/models-store.json')
            if '--session-id' in flags:
                at=flags.index('--session-id');sid=flags[at+1];del flags[at:at+2]
                at=flags.index('--session-dir');directory=Path(flags[at+1]);del flags[at:at+2]
                if directory!=APP/'sessions' or directory.is_symlink() or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}',sid): raise ValueError('Invalid session')
                directory.mkdir(mode=0o700,exist_ok=True)
                existing=list(directory.glob('*_'+sid+'.jsonl'))
                if len(existing)>1: raise ValueError('Ambiguous session')
                now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
                file=existing[0] if existing else directory/(now.replace(':','-').replace('.','-')+'_'+sid+'.jsonl')
                fd=os.open(file,os.O_RDWR|os.O_NOFOLLOW|(0 if existing else os.O_CREAT|os.O_EXCL),0o600)
                try:
                    s=os.fstat(fd)
                    if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: raise ValueError('Invalid session file')
                    if s.st_size==0: os.write(fd,(json.dumps(dict(type='session',version=3,id=sid,timestamp=now,cwd='/workspace'))+'\n').encode())
                    os.fchown(fd,user.pw_uid,user.pw_gid);os.fchmod(fd,0o600)
                finally: os.close(fd)
                # Bind one inode, never a host directory traversed by the root controller.
                b+=['--bind',str(file),'/session/current.jsonl'];flags+=['--session','/session/current.jsonl']
            for i, flag in enumerate(flags):
                if flag=='--extension':
                    f=Path(flags[i+1]);
                    if f.parent!=APP/'server' or f.name not in ('pi-vision.ts','pi-context-extension.ts'): raise ValueError('Unknown extension')
                    flags[i+1]='/opt/app/server/'+f.name
            args=[*flags,'--no-mcp',prompt]
        launch+=args
    b+=['--clearenv','--setenv','PATH','/opt/node/bin:/usr/bin:/bin','--setenv','HOME','/home/agent',
        '--setenv','TMPDIR','/tmp','--setenv','LANG','C.UTF-8','--setenv','NO_COLOR','1',
        '--chdir','/workspace']
    for k in ('PI_WEB_CONTEXT_FD','PI_WEB_VISION_ENDPOINT','PI_WEB_VISION_TOKEN'):
        if os.environ.get(k): b+=['--setenv',k,os.environ[k]]
    # Make the temporary home writable without exposing a host agent/config directory.
    enter = ('uid=$1; gid=$2; shift 2; chmod 0755 /etc /etc/ssl /opt /opt/app /home; '
             'if test -d /session; then chmod 0755 /session; fi; chmod 1777 /tmp; '
             'chown -R "$uid:$gid" /home/agent; '
             'exec /usr/bin/setpriv --reuid="$uid" --regid="$gid" --clear-groups --no-new-privs '
             '--bounding-set=-all --inh-caps=-all --ambient-caps=-all -- "$@"')
    b+=['/bin/sh','-ec',enter,'sh',str(user.pw_uid),str(user.pw_gid),*launch]
    os.umask(0o022)  # Traversable synthetic mountpoints; host-private files use explicit modes.
    os.execve(b[0],b,{'PATH':'/usr/bin:/bin'})


if __name__=='__main__':
    try: main()
    except Exception as exc:
        print('Workspace launch refused: '+str(exc),file=sys.stderr);sys.exit(1)
