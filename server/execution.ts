import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const jobs = new WeakMap<object,string>();

// The web service has a dedicated UID. Telegram has no sudo grant to this launcher.
const launcher = '/usr/local/sbin/pi-web-launch';
export const rootAvailable = process.env.PI_WEB_BROWSER_ADMIN === '1' && fs.existsSync(launcher);
export const rootEnabled = (value: unknown) => rootAvailable && value === true;
function control(action: 'status' | 'enable' | 'disable' | 'cleanup' | 'cancel' | 'forget', input = '') {
  const result = spawnSync('/usr/bin/sudo', ['-n', launcher, action], {
    encoding: 'utf8', input, timeout: 15000, env: { PATH: '/usr/bin:/bin' }
  });
  if (result.status !== 0) throw new Error('Browser administrative launcher is unavailable');
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
export function currentRootMode(): boolean {
  if (!rootAvailable) return false;
  return control('status').root === true;
}
export function setRootMode(value: unknown): boolean {
  if (!rootAvailable) return false;
  return control(value === true ? 'enable' : 'disable').root === true;
}
export function spawnAgent(command: string, args: string[], options: SpawnOptions, root: boolean) {
  const env = Object.fromEntries(Object.entries(options.env || process.env)
    .filter(([key,value]) => value !== undefined && !key.includes('PASSWORD') && !key.startsWith('SUDO_')));
  if (!rootAvailable) return spawn(command, args, {...options, env});
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
  if (rootAvailable) control('cleanup');
}
