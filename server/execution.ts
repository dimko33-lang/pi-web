import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import { randomUUID } from 'node:crypto';
const jobs = new WeakMap<object,string>();

// The web service has a dedicated UID. Telegram has no sudo grant to this launcher.
const launcher = '/usr/local/sbin/pi-web-launch';
const reference = process.env.PI_WEB_BROWSER_ADMIN === '1' && fs.existsSync(launcher);
const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;
const workspace = fileURLToPath(new URL('../services/browser/workspace.py', import.meta.url));
const stock = linuxRoot && !reference && workspace === '/root/PiWebRuntime/app/services/browser/workspace.py' &&
  !!process.env.PI_WEB_PASSWORD && process.env.PI_WEB_TICKET_FILE === '/root/PiWebRuntime/remote-access/access-link.json' &&
  fs.existsSync('/var/lib/pi-web-workspace/managed-v1') &&
  (fs.existsSync('/usr/bin/bwrap') || fs.existsSync('/var/lib/pi-web-workspace/bwrap')) && fs.existsSync(workspace);
let stockAdmin = false; // Never restore elevated permissions from disk after a restart.
export const rootAvailable = reference || stock;
function stockInvocation(command:string,args:string[],admin:boolean):[string,string[]] {
  return admin ? [command,args] : ['/usr/bin/python3',['-I',workspace,process.execPath,command,...args]];
}
export const rootEnabled = (value: unknown) => rootAvailable && value === true;
function control(action: 'status' | 'enable' | 'disable' | 'cleanup' | 'cancel' | 'forget', input = '') {
  const result = spawnSync('/usr/bin/sudo', ['-n', launcher, action], {
    encoding: 'utf8', input, timeout: 15000, env: { PATH: '/usr/bin:/bin' }
  });
  if (result.status !== 0) throw new Error('Browser administrative launcher is unavailable');
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
export function currentRootMode(): boolean {
  if (stock) return stockAdmin;
  if (!rootAvailable) return false;
  return control('status').root === true;
}
export function setRootMode(value: unknown): boolean {
  if (stock) {
    stockAdmin = false; // A failed enable/disable must never leave Root enabled.
    if (typeof value !== 'boolean') throw Error('Invalid Root switch');
    const [cmd,args] = stockInvocation('/usr/bin/id',['-u'],value);
    const p = spawnSync(cmd,args,{encoding:'utf8',timeout:5000});
    const expected = value ? '0' : fs.readFileSync('/var/lib/pi-web-workspace/managed-v1','utf8').trim();
    if ((!value && !/^[1-9]\d*$/.test(expected)) || p.status !== 0 || p.stdout.trim() !== expected) throw Error('Browser execution UID check failed');
    stockAdmin = value;
    return stockAdmin;
  }
  if (!rootAvailable) return false;
  return control(value === true ? 'enable' : 'disable').root === true;
}
export function spawnAgent(command: string, args: string[], options: SpawnOptions, root: boolean) {
  const env = Object.fromEntries(Object.entries(options.env || process.env)
    .filter(([key,value]) => value !== undefined && !key.includes('PASSWORD') && !key.startsWith('SUDO_')));
  if (stock) {
    if (root !== stockAdmin) throw Error('Browser privileges changed before launch');
    const [cmd,argv] = stockInvocation(command,args,root);
    return spawn(cmd,argv,{...options,env});
  }
  if (!rootAvailable) {
    if (linuxRoot || root) throw Error('Refusing to run the browser agent as root without a privilege boundary');
    return spawn(command, args, {...options, env});
  }
  if (root && !currentRootMode()) throw new Error('Root mode is off');
  const stdio = Array.isArray(options.stdio) ? [...options.stdio] : ['ignore','pipe','pipe'];
  stdio[0] = 'pipe';
  const child = spawn('/usr/bin/sudo', ['-n', '-C', '4', launcher, 'exec'], {
    ...options, stdio, env: {PATH:'/usr/bin:/bin'}, cwd:'/'
  });
  const job = randomUUID(); jobs.set(child,job);
  child.once('close', () => { try { control('forget',job); } catch { /* Process has already exited. */ } });
  child.stdin?.on('error', () => {});
  child.stdin?.end(JSON.stringify({command,args,env,cwd:String(options.cwd || '/'),root,job}));
  return child;
}
export function stopAgentProcess(child: ReturnType<typeof spawn>) {
  const job=jobs.get(child);
  if (rootAvailable && job) control('cancel',job);
  else if (child.pid) process.kill(-child.pid,'SIGKILL');
}
export function restoreRuntimeOwnership(_paths: string[]) {
  if (reference) control('cleanup');
}
