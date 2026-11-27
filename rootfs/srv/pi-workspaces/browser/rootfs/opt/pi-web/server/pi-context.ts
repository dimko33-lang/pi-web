import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type PiContextUsage = { tokens: number | null; contextWindow: number | null; percent: number | null };
export type PiContextConfig = { piBin: string; cwd: string; env: NodeJS.ProcessEnv; noExtensions: boolean };
const UNKNOWN: PiContextUsage = { tokens: null, contextWindow: null, percent: null };
const reader = fileURLToPath(new URL('./pi-context-reader.mjs', import.meta.url));

export function normalizeContext(value: any): PiContextUsage {
  const window = typeof value?.contextWindow === 'number' && Number.isFinite(value.contextWindow) && value.contextWindow > 0
    ? value.contextWindow : null;
  const known = window !== null && typeof value?.tokens === 'number' && Number.isFinite(value.tokens) && value.tokens >= 0
    && typeof value?.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0;
  return { tokens: known ? value.tokens : null, contextWindow: window, percent: known ? value.percent : null };
}

/** Resolve the package of this executable, never a separately installed project SDK. */
export function piSdkEntry(piBin: string): string {
  const bin = fs.realpathSync(piBin);
  const managed = path.resolve(path.dirname(bin), '../install');
  let start = path.dirname(bin);
  if (fs.existsSync(path.join(managed, 'current-version'))) {
    const version = fs.readFileSync(path.join(managed, 'current-version'), 'utf8').trim();
    if (!/^[\w.+-]+$/.test(version) || version === '.' || version === '..') throw new Error('Invalid Pi version');
    start = path.join(managed, 'releases', version, 'node_modules/@earendil-works/pi-coding-agent');
  }
  for (let dir = start; ; dir = path.dirname(dir)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@earendil-works/pi-coding-agent' || pkg.name === '@mariozechner/pi-coding-agent') {
        const entry = path.join(dir, 'dist/index.js');
        if (fs.existsSync(entry)) return entry;
      }
    } catch { /* Continue up from a normal npm CLI entry point. */ }
    if (path.dirname(dir) === dir) break;
  }
  throw new Error('Cannot resolve the running Pi SDK');
}

function configuration(config: PiContextConfig) {
  const agentDir = config.env.PI_CODING_AGENT_DIR || path.join(config.env.HOME || '', '.pi/agent');
  const sdkEntry = piSdkEntry(config.piBin);
  const parts: string[] = [sdkEntry, config.cwd, String(config.noExtensions)];
  let hasExtensions = false;
  const stamp = (name: string, recursive = false) => {
    try {
      const stat = fs.statSync(name);
      parts.push(name + ':' + stat.mtimeMs + ':' + stat.size);
      if (recursive && stat.isDirectory()) {
        for (const child of fs.readdirSync(name).sort()) {
          if (child !== 'node_modules' && child !== '.git') stamp(path.join(name, child), true);
        }
      }
    } catch { parts.push(name + ':missing'); }
  };
  for (const name of ['models.json', 'models-store.json']) stamp(path.join(agentDir, name));
  // Do not execute arbitrary extension factories merely to paint a status bar.
  // Until a real Pi process has reported its effective limit, extension-enabled
  // configurations are unknown rather than assuming the base catalog won.
  for (const base of [agentDir, path.join(config.cwd, '.pi')]) {
    const settingsFile = path.join(base, 'settings.json');
    stamp(settingsFile);
    if (!config.noExtensions) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        if (settings.packages?.length || settings.extensions?.some((s: string) => !s.startsWith('builtin:') && !s.startsWith('-'))) hasExtensions = true;
        for (const source of [...(settings.extensions || []), ...(settings.packages || [])]) {
          if (typeof source === 'string' && !/^(?:-?builtin:|npm:|git:|https?:)/.test(source)) {
            stamp(path.resolve(base, source.replace(/^~/, config.env.HOME || '')), true);
          }
        }
      } catch { /* Missing settings are normal. */ }
      const dir = path.join(base, 'extensions');
      stamp(dir, true);
      try { if (fs.readdirSync(dir).length) hasExtensions = true; } catch { /* No auto-discovered extensions. */ }
    }
  }
  return { agentDir, sdkEntry, signature: JSON.stringify(parts), hasExtensions };
}

export class PiContextStatus {
  private active: { token: symbol; session: string; model: string; signature: string; actualSession?: string; usage?: PiContextUsage } | null = null;
  private observed = new Map<string, PiContextUsage>();
  private ephemeral: { session: string; model: string; usage: PiContextUsage; signature: string } | null = null;
  private generation = 0;
  private pending = new Map<string, Promise<PiContextUsage>>();

  begin(session: string, model: string, config: PiContextConfig, ephemeral = false) {
    this.generation++;
    this.ephemeral = null;
    let signature = '';
    try { signature = configuration(config).signature; } catch { /* Live telemetry still works without an SDK. */ }
    const token = Symbol();
    this.active = { token, session, model, signature };
    return {
      receive: (event: any) => {
        const active = this.active;
        if (!active || active.token !== token || event?.type !== 'context_usage' || event.model !== model) return;
        active.actualSession = typeof event.session === 'string' ? event.session : undefined;
        active.usage = normalizeContext(event.usage);
        try { signature = configuration(config).signature; } catch { /* No SDK metadata available. */ }
        this.observed.set(signature + ':' + model, active.usage);
        if (ephemeral) this.ephemeral = { session, model, usage: active.usage, signature };
      },
      end: () => { if (this.active?.token === token) { this.active = null; this.generation++; } }
    };
  }

  async read(session: string, model: string, file: string | null, config: PiContextConfig, busy: boolean): Promise<PiContextUsage> {
    if (this.active || busy) {
      const a = this.active;
      return a && a.model === model && (a.session === session || a.actualSession === session) ? a.usage || { ...UNKNOWN } : { ...UNKNOWN };
    }
    try {
      const generation = this.generation;
      const c = configuration(config);
      if (this.ephemeral?.session === session && this.ephemeral.model === model && this.ephemeral.signature === c.signature) return this.ephemeral.usage;
      const observed = this.observed.get(c.signature + ':' + model);
      if (c.hasExtensions && !observed) return { ...UNKNOWN };
      // A positive live window is required; never replace an explicit unknown with a catalog guess.
      if (observed && !observed.contextWindow) return { ...UNKNOWN };
      const stat = file ? fs.statSync(file) : null;
      const key = JSON.stringify([session, model, file, stat?.mtimeMs, stat?.size, c.signature]);
      let pending = this.pending.get(key);
      if (!pending) {
        pending = new Promise<PiContextUsage>(resolve => {
          const child = spawn(process.execPath, [reader], {
            cwd: config.cwd, env: config.env, stdio: ['pipe', 'pipe', 'ignore']
          });
          let output = '';
          const timer = setTimeout(() => { child.kill('SIGKILL'); }, 10000);
          child.stdout.on('data', chunk => { output += chunk; if (output.length > 8192) child.kill('SIGKILL'); });
          child.on('error', () => { clearTimeout(timer); resolve({ ...UNKNOWN }); });
          child.stdin.on('error', () => {});
          child.on('close', code => {
            clearTimeout(timer);
            try { resolve(code === 0 ? normalizeContext(JSON.parse(output)) : { ...UNKNOWN }); }
            catch { resolve({ ...UNKNOWN }); }
          });
          child.stdin.end(JSON.stringify({ sdkEntry: c.sdkEntry, agentDir: c.agentDir, cwd: config.cwd, file, modelId: model, resolvedWindow: observed?.contextWindow }));
        });
        this.pending.set(key, pending);
        void pending.finally(() => this.pending.delete(key));
      }
      const result = await pending;
      // A run may have started while the offline reader was in flight.
      if (this.active) return this.active.model === model && (this.active.session === session || this.active.actualSession === session)
        ? this.active.usage || { ...UNKNOWN } : { ...UNKNOWN };
      return generation === this.generation ? result : { ...UNKNOWN };
    } catch { return { ...UNKNOWN }; }
  }
}

export const piContextStatus = new PiContextStatus();
