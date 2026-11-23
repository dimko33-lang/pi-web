// Release maintenance: stage reviewed paths first. Never enumerate an untracked workspace.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const list='server/export-list.json';
const paths=execFileSync('git',['ls-files','-z','--','README.md','RESTORE.md','package*.json','models.json','server','public','starter','services','telegram','docs','tests','tools/export-list.mjs']).toString().split('\0').filter(p=>p && !p.split('/').some(part=>part.startsWith('.')));
const files=[...new Set([...paths,list])].sort();
const seedHashes={};
for(const file of files.filter(f=>f.startsWith('starter/') || /^public\/.*\.(json|jpg|jpeg|png|webp|gif)$/i.test(f))) {
  seedHashes[file]=createHash('sha256').update(execFileSync('git',['show',':'+file],{maxBuffer:32*1024*1024})).digest('hex');
}
const output=JSON.stringify({files,seedHashes},null,2)+'\n';
if(process.argv.includes('--check')) {if(fs.readFileSync(list,'utf8')!==output) throw Error('Refresh the reviewed export list');}
else fs.writeFileSync(list,output);
