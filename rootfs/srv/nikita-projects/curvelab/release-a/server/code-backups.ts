import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const PARTS = ['project', 'public', 'server', 'docs', 'tests', 'deploy', 'package.json', 'package-lock.json', 'AGENTS.md', 'INSTALL.md', 'README.md'];
const ignored = (name: string) => name.startsWith('.') || name.includes('.bak') || /\.log$|\.GOOD-/.test(name) || name === 'node_modules';

export function createCodeBackups(root: string) {
  const directory = path.join(root, 'data', 'code-backups');
  const manifest = path.join(directory, 'latest.json');
  let pending: Promise<any> | null = null;

  function inventory() {
    const files: string[] = [];
    function walk(relative: string) {
      const full = path.join(root, relative);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(full).sort()) if (!ignored(name)) walk(path.join(relative, name));
      } else if (stat.isFile()) files.push(relative);
    }
    for (const part of PARTS) if (fs.existsSync(path.join(root, part))) walk(part);
    files.sort();
    const hash = crypto.createHash('sha256');
    for (const file of files) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
    return { files, hash: hash.digest('hex') };
  }

  function latest() {
    try {
      const meta = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (path.basename(meta.name) !== meta.name || !fs.existsSync(path.join(directory, meta.name))) return null;
      return meta;
    } catch { return null; }
  }

  async function build() {
    const before = inventory();
    const old = latest();
    if (old?.hash === before.hash) return old;
    fs.mkdirSync(directory, { recursive: true });
    const staging = fs.mkdtempSync(path.join(directory, '.staging-'));
    try {
      for (const file of before.files) {
        const target = path.join(staging, 'curvelab', file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file), target);
      }
      if (inventory().hash !== before.hash) throw new Error('Code changed during backup; retry after edits finish');
      const at = Date.now();
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
      const get = (type: string) => parts.find(p => p.type === type)!.value;
      const stamp = `${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}-${get('second')}`;
      const name = `curvelab-project-${stamp}-${before.hash.slice(0, 8)}.tar.gz`;
      const tmp = path.join(staging, 'archive.tar.gz');
      await exec('tar', ['-czf', tmp, '-C', staging, 'curvelab']);
      await exec('tar', ['-tzf', tmp]);
      fs.renameSync(tmp, path.join(directory, name));
      const meta = { at, name, hash: before.hash, timeZone: 'Europe/Moscow' };
      fs.writeFileSync(manifest + '.tmp', JSON.stringify(meta));
      fs.renameSync(manifest + '.tmp', manifest);
      return meta;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }

  return {
    latest,
    ensure() {
      if (!pending) pending = build().finally(() => { pending = null; });
      return pending;
    },
    file(name: string) {
      if (path.basename(name) !== name || !/^curvelab-project-[\w-]+\.tar\.gz$/.test(name)) return null;
      const full = path.join(directory, name);
      return fs.existsSync(full) ? full : null;
    },
  };
}
