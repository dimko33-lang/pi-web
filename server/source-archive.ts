import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const roots = ['server', 'public', 'tests', 'deploy', 'docs'];
const telegramFiles = ['install.sh','instance.py','service.py','salon_archive.py','telegram_blocks.py','lc_recovery.py','requirements.lock'];
const files = ['package.json', 'package-lock.json', 'models.json', 'README.md'];
const optionalFiles = ['AGENTS.md', 'INTERACTIVE-CARDS.md', 'RESTORE.md', 'start.sh'];
const sourceExtension = /\.(?:ts|js|mjs|cjs|html|css|svg|json|md|sh|service|png|jpg|webp|woff2?|ttf|otf|map)$/i;

/** Source-only export: runtime directories and credentials are never traversed. */
export async function createSourceArchive(root: string) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-export-'));
  const cleanup = () => fs.rm(temporary, { recursive: true, force: true });
  const destination = path.join(temporary, 'pi-web');
  async function copy(source: string, target: string) {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) return;
    const name = path.basename(source);
    if (name.startsWith('.') || /^(?:node_modules|data|sessions|backups|auth|credentials|secrets)$/i.test(name) || /(?:\.bak(?:[.-]|$)|\.log$)/i.test(name)) return;
    if (stat.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      for (const child of await fs.readdir(source)) await copy(path.join(source, child), path.join(target, child));
    } else if (stat.isFile() && sourceExtension.test(name)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      await fs.chmod(target, name.endsWith('.sh') ? 0o755 : 0o644);
    }
  }
  try {
    await fs.mkdir(destination);
    for (const relative of files) await copy(path.join(root, relative), path.join(destination, relative));
    for (const relative of [...optionalFiles, ...roots]) {
      try { await copy(path.join(root, relative), path.join(destination, relative)); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
    // Export only Telegram program files, never instance state or login material.
    if (await fs.stat(path.join(root, 'telegram/install.sh')).then(() => true, () => false)) {
      const target = path.join(destination, 'telegram'); await fs.mkdir(target);
      for (const file of telegramFiles) {
        const src = path.join(root, 'telegram', file);
        if (!(await fs.lstat(src)).isFile()) throw Error('Invalid Telegram source file');
        await fs.copyFile(src, path.join(target, file));
      }
    }
    for (const relative of ['services/tools.mjs','services/tool-policy.txt','services/science/Dockerfile','services/science/requirements.lock','services/science/worker.py','services/science/install.sh','services/science/pi-web-science.service']) {
      const src=path.join(root,relative), target=path.join(destination,relative);
      try { if (!(await fs.lstat(src)).isFile() || await fs.realpath(src)!==path.join(await fs.realpath(root),relative)) throw Error('Invalid worker source file'); }
      catch(e:any){ if(e.code==='ENOENT')continue; throw e; }
      await fs.mkdir(path.dirname(target),{recursive:true}); await fs.copyFile(src,target);
    }
    const config = path.join(destination, 'data');
    await fs.mkdir(config);
    // Do not copy arbitrary runtime JSON or custom prompt text into a portable archive.
    try {
      const settings = JSON.parse(await fs.readFile(path.join(root, 'data/browser-settings.json'), 'utf8'));
      const safe = Object.fromEntries(['memory', 'systemPrompt', 'root'].filter(key => typeof settings[key] === 'boolean').map(key => [key, settings[key]]));
      await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify(safe, null, 2));
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    try {
      const model = (await fs.readFile(path.join(root, 'data/browser-model.txt'), 'utf8')).trim();
      const allowed = JSON.parse(await fs.readFile(path.join(root, 'models.json'), 'utf8'));
      if (allowed.includes(model)) await fs.writeFile(path.join(config, 'model.txt'), model);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const name = `pi-web-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const archive = path.join(temporary, name);
    await exec('tar', ['-czf', archive, '-C', temporary, 'pi-web']);
    return { file: archive, name, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
