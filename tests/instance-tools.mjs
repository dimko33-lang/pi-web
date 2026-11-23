// Offline: no provider credentials, sessions, images or paid model calls are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generatePicture,imageBlock} from '../server/instance-image.ts';
import {science} from '../server/instance-tools.ts';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nikita-image-sdk-'));
try {
  const img='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xsAAAAASUVORK5CYII=';
  const pi=path.join(dir,'bin/pi'); fs.mkdirSync(path.dirname(pi));fs.writeFileSync(pi,'');
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',type:'module'}));fs.mkdirSync(path.join(dir,'dist'));
  fs.writeFileSync(path.join(dir,'dist/index.js'),`export const ModelRuntime={create:async()=>({getAvailableOfType:async(_,p)=>p==='test'?[{id:'fixture'}]:[],generateImages:async(_,ctx)=>({output:[{type:'image',data:'${img}'}]}),isUsingOAuth:()=>false,getAuth:()=>{throw Error('Unexpected credential lookup')}})}`);
  assert.equal((await generatePicture('owl',pi,'test/chat')).data,img);
  assert.equal((await generatePicture('edit',pi,'test/chat',undefined,img)).mimeType,'image/png');
  await assert.rejects(generatePicture('owl',pi,'text-only/chat'),/No image capability/);
  await assert.rejects(generatePicture('owl',pi,'openai-codex/chat'),/No image capability/);
  assert.throws(()=>imageBlock('aGVsbG8='),/format/);
  await assert.rejects(science({action:'shell'}),/Invalid/);
  console.log('Instance tools: provider reuse, image delivery/edits, invalid input and no cross-provider fallback passed.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
