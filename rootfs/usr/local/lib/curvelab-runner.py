"""Socket-activated, single-project offline command runner. No client-selectable mounts/network."""
import fcntl,json,os,secrets,subprocess,sys,threading,runpy
from pathlib import Path
D='/usr/bin/docker';IMAGE='curvelab-project-runtime:stage';WORK='/srv/nikita-projects/curvelab/work'
def run(req):
    script=req.get('command');assert isinstance(script,str) and 0<len(script)<=30000
    lock=open('/run/curvelab-runner.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if not os.path.ismount('/srv/nikita-projects/curvelab'):raise RuntimeError('Project storage unavailable')
    if script in ('@publish','@withdraw','@rollback','@check'):
        return runpy.run_path('/usr/local/lib/curvelab-release.py')['release'](script[1:])
    name='cl-work-'+secrets.token_hex(8);log=bytearray()
    args=[D,'run','--name',name,'--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--user','1000:1000','--pids-limit','128','--memory','640m','--cpus','1.5','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--mount','type=bind,src='+WORK+',dst=/project','-v','/run/curvelab-deps.sock:/run/deps.sock:ro','-v','/usr/local/lib/curvelab-relay.cjs:/relay.cjs:ro','-e','HTTPS_PROXY=http://127.0.0.1:18880','-e','HTTP_PROXY=http://127.0.0.1:18880','-e','NO_PROXY=localhost,127.0.0.1','-e','HOME=/tmp','-w','/project',IMAGE,'sh','-c','node /relay.cjs & sleep 0.1; exec sh -c "$1"','project',script]
    try:
        proc=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        def drain():
            while block:=proc.stdout.read(8192):
                log.extend(block);del log[:-24000]
        t=threading.Thread(target=drain,daemon=True);t.start()
        try:code=proc.wait(timeout=45)
        except subprocess.TimeoutExpired:code=124
    finally:
        subprocess.run([D,'rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    t.join(2);return {'exit':code,'output':log.decode(errors='replace')}
try:out=run(json.loads(sys.stdin.buffer.readline(65536)))
except Exception as exc:out={'error':str(exc)[:250] or type(exc).__name__}
print(json.dumps(out),flush=True)
