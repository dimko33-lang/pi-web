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
  try { fs.copyFileSync(path.join(seed, 'profiles.json'), dest, fs.constants.COPYFILE_EXCL); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  process.env.PI_WEB_CONVERSATION_PROFILES = fs.readFileSync(path.join(seed, 'catalog.json'), 'utf8');
  process.env.PI_WEB_SHARED_SYSTEM_PROMPT ??= path.join(seed, 'system.md');
}
