import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createSourceArchive} from '../server/source-archive.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'nikita-restore-'));
let archive;
try {
  const source=path.join(tmp,'source'), list=JSON.parse(await fs.readFile(path.join(root,'server/export-list.json'),'utf8'));
  for(const f of list.files){const target=path.join(source,f);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,f),target);}
  for(const f of ['data/browser-settings.json','telegram-state/connection.json','public/nikita/data/unlisted.json','public/secret-photo.jpg','starter/.env']){
    const target=path.join(source,f);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'private fixture');
  }
  archive=await createSourceArchive(source);execFileSync('tar',['-xzf',archive.file,'-C',tmp]);
  const extracted=path.join(tmp,'pi-web'),dest=path.join(tmp,'restored');
  const extractedFiles=execFileSync('tar',['-tzf',archive.file],{encoding:'utf8'}).split('\n').filter(s=>s&&!s.endsWith('/'));
  assert.deepEqual(extractedFiles.sort(),[...list.files,'restore-checksums.json'].map(s=>'pi-web/'+s).sort());
  const restore=dir=>execFileSync(process.execPath,[path.join(extracted,'docs/restore-source.mjs'),extracted,dir],{stdio:'pipe'});
  restore(dest);
  for(const f of list.files) assert.ok((await fs.readFile(path.join(root,f))).equals(await fs.readFile(path.join(dest,f))),f);
  for (const file of ['LICENSE','docs/licenses/pi-MIT.txt','docs/licenses/katex-fonts-OFL.txt']) assert.ok(list.files.includes(file),`Missing license: ${file}`);
  const notes=JSON.parse(await fs.readFile(path.join(dest,'public/nikita/data/index.json'),'utf8'));assert.equal(notes.length,18);
  await fs.appendFile(path.join(extracted,'server/main.ts'),'changed');assert.throws(()=>restore(path.join(tmp,'damaged')));
  await fs.writeFile(path.join(source,'public/nikita/piwep/messages.json'),'["private"]');await assert.rejects(createSourceArchive(source),/Modified seed/);
  console.log(`Save -> extract -> restore: ${list.files.length} files verified; private extras excluded, damaged archive and modified feed rejected.`);
}finally{await archive?.cleanup();await fs.rm(tmp,{recursive:true,force:true});}
