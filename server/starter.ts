// Apply starter data only on an unconfigured standalone installation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const seed = path.join(root, 'starter');
if (process.env.PI_WEB_CONVERSATION_PROFILES === undefined && !process.env.PI_WEB_TELEGRAM_DATA) {
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const dest = path.join(data, 'conversation-profiles.json');
  // Provider selection is instance state. Do not pin a fresh DM to the builder's provider.
  const initial = JSON.parse(fs.readFileSync(path.join(seed, 'profiles.json'), 'utf8'));
  for (const profile of Object.values(initial.profiles) as Record<string, unknown>[]) {
    delete profile.model;
    delete profile.thinking;
  }
  try { fs.writeFileSync(dest, JSON.stringify(initial), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  process.env.PI_WEB_CONVERSATION_PROFILES = fs.readFileSync(path.join(seed, 'catalog.json'), 'utf8');
  process.env.PI_WEB_SHARED_SYSTEM_PROMPT ??= path.join(seed, 'system.md');
}
