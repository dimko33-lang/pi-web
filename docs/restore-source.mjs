// A trusted, unpacked panel Save. Copy only its declared files; ignore adjacent state.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const src=await fs.realpath(process.argv[2]), dest=process.argv[3];
const manifest=JSON.parse(await fs.readFile(path.join(src,'server/export-list.json'),'utf8'));
const sums=JSON.parse(await fs.readFile(path.join(src,'restore-checksums.json'),'utf8'));
if(!Array.isArray(manifest.files)||!manifest.files.includes('server/main.ts')||!manifest.files.includes('docs/install.sh')) throw Error('Incomplete Save');
await fs.mkdir(dest,{mode:0o700});
for(const rel of manifest.files){
  if(typeof rel!=='string'||!rel.split('/').every(s=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(s))) throw Error('Invalid source list');
  const source=path.join(src,rel),target=path.join(dest,rel);
  if(await fs.realpath(source)!==source||!(await fs.lstat(source)).isFile()) throw Error('Not a regular source: '+rel);
  const data=await fs.readFile(source);
  if(createHash('sha256').update(data).digest('hex')!==sums[rel]) throw Error('Damaged Save: '+rel);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx',mode:rel.endsWith('.sh')?0o755:0o644});
}
