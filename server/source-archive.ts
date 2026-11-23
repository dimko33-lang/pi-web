import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Only reviewed distribution paths. Never walk a live application or its data folders. */
export async function createSourceArchive(root: string) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-export-'));
  const cleanup = () => fs.rm(temporary, { recursive: true, force: true });
  const destination = path.join(temporary, 'pi-web');
  try {
    const physical = await fs.realpath(root);
    const manifest = JSON.parse(await fs.readFile(path.join(physical,'server/export-list.json'),'utf8'));
    const sums: Record<string,string> = {};
    for (const rel of manifest.files) {
      if (typeof rel !== 'string' || !rel.split('/').every((s:string)=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(s))) throw Error('Invalid source list');
      const src = path.join(physical,rel), dest = path.join(destination,rel);
      if (await fs.realpath(src) !== src || !(await fs.lstat(src)).isFile()) throw Error('Invalid source: '+rel);
      const bytes=await fs.readFile(src), hash=digest(bytes);
      if (manifest.seedHashes[rel] && manifest.seedHashes[rel] !== hash) throw Error('Modified seed content; review before export: '+rel);
      await fs.mkdir(path.dirname(dest), {recursive:true});
      await fs.writeFile(dest, bytes, {mode:rel.endsWith('.sh')?0o755:0o644}); sums[rel]=hash;
    }
    await fs.writeFile(path.join(destination,'restore-checksums.json'), JSON.stringify(sums));
    const name = `pi-web-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const archive = path.join(temporary, name);
    await exec('tar', ['-czf', archive, '-C', temporary, 'pi-web']);
    return { file: archive, name, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
