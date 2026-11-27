import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

// This subprocess never executes extensions, prompts, tools, auth commands or network I/O.
// Session entries, settings, credentials and model-store mutations stay in memory.
export async function readPiContext({ sdkEntry, cwd, agentDir, file, modelId, resolvedWindow, operation }) {
  const sdk = await import(pathToFileURL(sdkEntry).href);
  const { loadEntriesFromFile } = await import(pathToFileURL(path.join(path.dirname(sdkEntry), 'core/session-manager.js')).href);
  const readJson = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(agentDir, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const auth = readJson('auth.json');
  const store = readJson('models-store.json');
  const forbidden = () => { throw new Error('Context reader is read-only and offline'); };
  const runtime = await sdk.ModelRuntime.create({
    modelsPath: path.join(agentDir, 'models.json'),
    allowModelNetwork: false,
    credentials: {
      read: async id => auth[id],
      list: async () => Object.entries(auth).map(([providerId, value]) => ({ providerId, type: value.type === 'oauth' ? 'oauth' : 'api_key' })),
      modify: forbidden, delete: forbidden
    },
    modelsStore: {
      read: async id => store[id],
      write: async (id, entry) => { store[id] = entry; },
      delete: async id => { delete store[id]; }
    }
  });
  const slash = modelId.indexOf('/');
  const model = runtime.getModel(modelId.slice(0, slash), modelId.slice(slash + 1));
  if (!model) return null;
  if (operation === 'thinking') {
    const ai = await import(pathToFileURL(path.resolve(path.dirname(sdkEntry), '../../pi-ai/dist/models.js')).href);
    const defaults = await import(pathToFileURL(path.join(path.dirname(sdkEntry), 'core/defaults.js')).href);
    return { levels: ai.getSupportedThinkingLevels(model), defaultLevel: ai.clampThinkingLevel(model, defaults.DEFAULT_THINKING_LEVEL) };
  }
  // A live Pi observation includes models.json, extensions and routing. Prefer its limit.
  const selected = resolvedWindow == null ? model : { ...model, contextWindow: resolvedWindow };
  const entries = file ? loadEntriesFromFile(file) : undefined;
  const manager = sdk.SessionManager.inMemory(cwd, undefined, entries);
  const resources = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources() {}, reload: async () => {}
  };
  const { session } = await sdk.createAgentSession({
    cwd, agentDir, model: selected, modelRuntime: runtime,
    thinkingLevel: 'off', noTools: 'all', resourceLoader: resources,
    sessionManager: manager, settingsManager: sdk.SettingsManager.inMemory({ cacheWarming: 'off' })
  });
  try { return session.getContextUsage() ?? null; }
  finally { session.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  globalThis.fetch = () => { throw new Error('Context reader network access is forbidden'); };
  net.Socket.prototype.connect = function () { throw new Error('Context reader network access is forbidden'); };
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const usage = await readPiContext(JSON.parse(input));
    process.stdout.write(JSON.stringify(usage) + '\n');
  } catch {
    process.stdout.write('null\n');
    process.exitCode = 1;
  }
}
