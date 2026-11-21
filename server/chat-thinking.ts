import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { piSdkEntry, type PiContextConfig } from './pi-context.ts';

export class ChatThinking {
  constructor(private file = fileURLToPath(new URL('../data/browser-thinking.json', import.meta.url))) {}
  async get(model: string, config: PiContextConfig) {
    let metadata: any;
    try {
      const sdkEntry = piSdkEntry(config.piBin);
      metadata = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./pi-context-reader.mjs', import.meta.url))], {
        cwd: config.cwd, env: config.env, stdio: ['pipe', 'pipe', 'ignore']
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      let output = '';
      child.stdout.on('data', c => { output += c; });
      child.on('error', reject);
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer);
        try { if (code) throw Error('Pi thinking metadata unavailable'); resolve(JSON.parse(output)); }
        catch (e) { reject(e); }
      });
      child.stdin.end(JSON.stringify({ sdkEntry, cwd: config.cwd,
        agentDir: config.env.PI_CODING_AGENT_DIR || path.join(config.env.HOME || '', '.pi/agent'), modelId: model, operation: 'thinking' }));
      });
    } catch (error) {
      const catalog = JSON.parse(fs.readFileSync(new URL('../starter/thinking.json', import.meta.url), 'utf8'));
      const preset = catalog[model];
      if (!preset?.levels?.length) throw error;
      metadata = { levels: preset.levels, defaultLevel: preset.levels[0] };
    }
    if (!metadata?.levels?.length) throw Error('Pi thinking metadata unavailable');
    let saved: any = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { model, levels: metadata.levels, level: metadata.levels.includes(saved[model]) ? saved[model] : metadata.defaultLevel };
  }
  async set(model: string, level: string, config: PiContextConfig) {
    const state = await this.get(model, config);
    if (!state.levels.includes(level)) throw Error('Unsupported thinking level');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ ...saved, [model]: level }));
    fs.renameSync(temp, this.file);
    return { ...state, level };
  }
}
export const chatThinking = new ChatThinking();
