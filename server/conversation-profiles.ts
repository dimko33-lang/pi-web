import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';

type Profile = {
  textOutput?: boolean; voiceOutput?: boolean; voicePreset?: 'gacrux' | 'charon-elder';
  model: string; thinking: string; systemPrompt: boolean; character: string;
  customPrompt: string; customOn?: boolean; basePrompt?: string; baseOn?: boolean; piOn?: boolean; toolsOn?: boolean; tail: string; tailOn: boolean; memory: boolean;
  personLimit?: number; memoryLimit: number; backgroundLimit: number; replyMode: string;
  personOn?: boolean; groupOn?: boolean; backgroundOn?: boolean;
  memoryEpoch: string; memoryResetAt: number;
};
type CatalogEntry = {
  id: string; label: string; chatId: number | null; chatIds?: number[];
  kind?: 'group' | 'private' | 'private_default'; tailKey: string;
  backgroundLimit?: number; enabledKey?: string;
};
const windows = [['personOn', 'personLimit'], ['groupOn', 'memoryLimit'], ['backgroundOn', 'backgroundLimit']] as const;
function panelSettings(settings: Profile, entry: CatalogEntry) {
  if (!entry.kind || entry.kind === 'group') {
    // Project old groups into the new UI without writing the store or losing paused counts.
    for (const [on, count] of windows) settings[on] ??= settings.memory && (settings[count] ?? 0) > 0;
  }
  if (entry.kind === 'private') settings.voicePreset ??= 'gacrux';
  return settings;
}
// Keep the former tag-only value readable without silently widening old settings.
const modes = ['mention_reply', 'addressed', 'mentions', 'all', 'off'];

export function createConversationProfiles(options: {
  directory: string; defaults: (entry: CatalogEntry) => Profile;
  basePrompt: () => string; piReference: () => Promise<string>;
  models: () => string[]; thinking: (model: string) => Promise<{ levels: string[]; level: string }>;
  notice?: (entry: CatalogEntry) => string;
}) {
  const catalog: CatalogEntry[] = JSON.parse(process.env.PI_WEB_CONVERSATION_PROFILES || '[]');
  const enrollment = path.join(options.directory, 'individual-dms.json');
  if (fs.existsSync(enrollment)) {
    const entries = JSON.parse(fs.readFileSync(enrollment, 'utf8'));
    for (const [peer, label] of Object.entries(entries)) {
      if (!/^[1-9]\d*$/.test(peer) || !Number.isSafeInteger(Number(peer)) || typeof label !== 'string') throw Error('Invalid DM enrollment');
      if (!catalog.some(entry => entry.chatId === Number(peer))) catalog.push({ id: 'dm_' + peer, label, chatId: Number(peer), kind: 'private', tailKey: 'tailDirect' });
    }
  }
  const file = path.join(options.directory, 'conversation-profiles.json');
  const router = Router();
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value.version !== 1 || !Number.isInteger(value.revision) || !value.profiles) throw Error('Invalid conversation profiles');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { version: 1, revision: 0, profiles: {} };
    }
  };
  const addressingNames = (): string[] | null => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(options.directory, 'addressing.json'), 'utf8'));
      if (!value || !Array.isArray(value.names) || value.names.length > 20
          || value.names.some((name: unknown) => typeof name !== 'string' || !name.trim() || name.length > 100)) return null;
      return value.names;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
    }
  };
  const view = (data: ReturnType<typeof read>) => ({
    addressingNames: addressingNames(),
    title: process.env.PI_WEB_CONVERSATION_TITLE || 'Conversations', revision: data.revision,
    profiles: catalog.map(entry => ({ id: entry.id, label: entry.label, chatId: entry.chatId,
      chatIds: entry.chatIds || (entry.chatId ? [entry.chatId] : []), kind: entry.kind || 'group',
      notice: options.notice?.(entry) || '',
      independent: !!data.profiles[entry.id], settings: panelSettings({ personLimit: 0, textOutput: false, voiceOutput: false, piOn: false, customOn: true, baseOn: true, toolsOn: true, basePrompt: options.basePrompt(),
        ...options.defaults(entry), ...(entry.id.startsWith('dm_') && !data.profiles[entry.id] ? data.profiles.guest_dm : {}), ...data.profiles[entry.id] }, entry) }))
  });
  const validate = async (input: any, entry: CatalogEntry): Promise<Profile> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid profile');
    const allowed = ['textOutput', 'voiceOutput', 'voicePreset', 'piOn', 'model', 'thinking', 'systemPrompt', 'character', 'customPrompt', 'customOn', 'basePrompt', 'baseOn', 'toolsOn', 'tail', 'tailOn',
      'memory', 'personLimit', 'memoryLimit', 'backgroundLimit', ...windows.map(([on]) => on), 'replyMode'];
    if (Object.keys(input).some(key => !allowed.includes(key))) throw Error('Unknown profile field');
    for (const key of ['textOutput','voiceOutput']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw Error('Invalid ' + key);
    if ('voicePreset' in input && (entry.kind !== 'private' || !['gacrux', 'charon-elder'].includes(input.voicePreset))) throw Error('Unknown or non-private voice preset');
    if (input.piOn !== undefined && typeof input.piOn !== 'boolean') throw Error('Invalid piOn');
    const explicit = windows.some(([on]) => on in input);
    if (explicit) {
      if (entry.kind && entry.kind !== 'group') throw Error('Private conversations use Dialogue only');
      if (!Number.isInteger(input.personLimit)) throw Error('Missing participant window');
      for (const [on, count] of windows) {
        if (typeof input[on] !== 'boolean' || (input[on] && !input[count])) throw Error('Invalid ' + on);
      }
    }
    if ((!explicit || 'memory' in input) && typeof input.memory !== 'boolean') throw Error('Invalid memory');
    for (const key of ['systemPrompt', 'customOn', 'baseOn', 'toolsOn', 'tailOn']) if (typeof input[key] !== 'boolean') throw Error('Invalid ' + key);
    for (const [key, limit] of [['basePrompt', 30000], ['character', 8000], ['customPrompt', 20000], ['tail', 4000]] as const) {
      if (typeof input[key] !== 'string' || input[key].length > limit) throw Error('Invalid ' + key);
    }
    if (input.personLimit !== undefined && (!Number.isInteger(input.personLimit) || input.personLimit < 0 || input.personLimit > 500)) throw Error('Person window must be 0 to 500');
    if (entry.kind && entry.kind !== 'group' && input.personLimit) throw Error('Private conversations have no participant window');
    if (!Number.isInteger(input.memoryLimit) || input.memoryLimit < 0 || input.memoryLimit > 500) throw Error('Dialogue window must be 0 to 500');
    if (!Number.isInteger(input.backgroundLimit) || input.backgroundLimit < 0 || input.backgroundLimit > 500) throw Error('Background window must be 0 to 500');
    if (entry.kind && entry.kind !== 'group' && input.backgroundLimit !== 0) throw Error('Private conversations have no group background');
    if (!modes.includes(input.replyMode)) throw Error('Invalid reply mode');
    if (!options.models().includes(input.model)) throw Error('Unknown model');
    const metadata = await options.thinking(input.model);
    if (!metadata.levels.includes(input.thinking)) throw Error('Unsupported thinking level');
    const profile = Object.fromEntries(allowed.map(key => [key, input[key]])) as Profile;
    if (explicit) profile.memory = windows.some(([on]) => input[on]); // Compatibility summary, not a fourth switch.
    return profile;
  };
  router.get('/', (_req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json(view(read())); }
    catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  router.get('/pi-reference', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store'); res.json({ text: await options.piReference() });
    } catch { res.status(503).json({ error: 'Installed Pi instructions are unavailable.' }); }
  });
  router.get('/thinking', async (req, res) => {
    try {
      const model = String(req.query.model || '');
      if (!options.models().includes(model)) throw Error('Unknown model');
      res.setHeader('Cache-Control', 'no-store'); res.json(await options.thinking(model));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/:id', async (req, res) => {
    try {
      const entry = catalog.find(item => item.id === req.params.id);
      if (!entry) return res.status(404).json({ error: 'Unknown conversation' });
      let next: Profile | undefined;
      let inherited: Profile | undefined;
      if (req.body.action === 'save') next = await validate(req.body.settings, entry);
      else if (req.body.action === 'reset' || req.body.action === 'restore') {
        if (!read().profiles[entry.id]) {
          inherited = options.defaults(entry);
          const metadata = await options.thinking(inherited.model);
          inherited.thinking = metadata.levels.includes(inherited.thinking) ? inherited.thinking : metadata.level;
        }
      } else throw Error('Unknown profile action');
      // Validation awaits metadata. Re-read only afterwards so concurrent saves cannot win silently.
      const data = read();
      if (req.body.revision !== data.revision) return res.status(409).json({ error: 'Settings changed in another tab. Reload before saving.' });
      const previous = { ...(inherited || options.defaults(entry)), ...data.profiles[entry.id] };
      if (!next) next = { ...previous };
      else if (next.piOn === undefined) next.piOn = previous.piOn ?? false; // Older panel tabs preserve the setting.
      next.personLimit ??= previous.personLimit ?? 0; // Preserve saved values for older panel tabs.
      if (previous.personOn !== undefined && next.personOn === undefined) {
        // An old tab can edit other fields, but must not silently unpause a saved window.
        if (next.memory !== previous.memory || windows.some(([, count]) => next![count] !== previous[count])) {
          return res.status(409).json({ error: 'Reload this page to change individual memory windows.' });
        }
        for (const [on] of windows) next[on] = previous[on];
      }
      next.textOutput ??= previous.textOutput ?? false;
      next.voiceOutput ??= previous.voiceOutput ?? false;
      if (entry.kind === 'private') next.voicePreset ??= previous.voicePreset; // An older tab must not clear a saved speaker.
      const reset = req.body.action === 'reset';
      const restore = req.body.action === 'restore';
      // Both history actions rotate the generation so Telegram repins its local floor.
      // Old Chat removes the boundary, not the saved limits or window switches.
      // Ordinary saves and first activation preserve the existing conversation.
      next.memoryEpoch = reset || restore ? crypto.randomUUID() : previous.memoryEpoch;
      next.memoryResetAt = reset ? Date.now() : restore ? 0 : previous.memoryResetAt;
      const updated = { ...data, revision: data.revision + 1, profiles: { ...data.profiles, [entry.id]: next } };
      fs.mkdirSync(options.directory, { recursive: true });
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify(updated, null, 2), { mode: 0o600 });
        // The dedicated browser owns writes; the Telegram group only needs reads.
        if (process.env.PI_WEB_TELEGRAM_DATA) fs.chmodSync(temporary, 0o640);
        fs.renameSync(temporary, file);
      } finally { try { fs.unlinkSync(temporary); } catch { /* Already published. */ } }
      res.json(view(updated));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
