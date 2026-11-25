// Exercise the fresh-install profile API with an offline model catalog and disposable data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import express from 'express';
import {createConversationProfiles} from '../server/conversation-profiles.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nikita-profile-')); let server;
try {
  await fs.cp(path.join(root,'starter'),path.join(dir,'starter'),{recursive:true});
  await fs.mkdir(path.join(dir,'server'));
  await fs.copyFile(path.join(root,'server/starter.ts'),path.join(dir,'server/starter.mts'));
  delete process.env.PI_WEB_TELEGRAM_DATA; delete process.env.PI_WEB_CONVERSATION_PROFILES;
  await import(pathToFileURL(path.join(dir,'server/starter.mts')).href);
  const app=express(); app.use(express.json()); const model='fixture/subscription';
  app.use('/profiles',createConversationProfiles({directory:path.join(dir,'data'),
    defaults:()=>({model,thinking:'low',memoryEpoch:'initial',memoryResetAt:0}), basePrompt:()=>'',
    models:()=>[model],thinking:async()=>({levels:['low'],level:'low'}),piReference:async()=>'Local Pi reference'}));
  server=await new Promise(ok=>{const s=app.listen(0,'127.0.0.1',()=>ok(s));});
  const url=`http://127.0.0.1:${server.address().port}/profiles`;
  const view=await (await fetch(url)).json(); const owner=view.profiles.find(p=>p.id==='owner_dm');
  assert.equal(owner.settings.model,model); assert.equal(owner.settings.thinking,'low');
  assert.equal((await (await fetch(url+'/pi-reference')).json()).text,'Local Pi reference');
  const settings={...owner.settings,piOn:true,toolsOn:false}; delete settings.memoryResetAt; delete settings.memoryEpoch;
  const save=await fetch(url+'/owner_dm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',settings,revision:view.revision})});
  assert.equal(save.status,200); const saved=JSON.parse(await fs.readFile(path.join(dir,'data/conversation-profiles.json'),'utf8'));
  assert.equal(saved.profiles.owner_dm.model,model);assert.equal(saved.profiles.owner_dm.piOn,true);
  assert.equal(saved.profiles.owner_dm.toolsOn,false);assert.notEqual(saved.profiles.guest_dm.piOn,true);
  let current=await save.json();
  const change=(id,action,values)=>fetch(url+'/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision:current.revision,settings:values})});
  const group=current.profiles.find(p=>p.id==='lake'), flags=['personOn','groupOn','backgroundOn'];
  assert.deepEqual(flags.map(k=>group.settings[k]),[false,true,true]);assert.equal(group.settings.personLimit,0);
  assert.equal(saved.profiles.lake.personOn,undefined,'GET must not migrate the store');
  const edit={...group.settings,personOn:false,groupOn:true,backgroundOn:false,personLimit:100,memoryLimit:42,backgroundLimit:9};
  delete edit.memoryEpoch;delete edit.memoryResetAt;delete edit.memory; // New group clients have no master switch.
  for(const value of [-1,501,1.5,'100',null,true])assert.equal((await change('lake','save',{...edit,personLimit:value})).status,400);
  assert.equal((await change('owner_dm','save',{...settings,personLimit:1})).status,400);
  for(const bad of [{personOn:1},{groupOn:undefined},{backgroundOn:'off'},{personOn:true,personLimit:0}])
    assert.equal((await change('lake','save',{...edit,...bad})).status,400);
  assert.equal((await change('owner_dm','save',{...settings,personOn:false,groupOn:false,backgroundOn:false})).status,400);
  const update=async(action,values)=>{const r=await change('lake',action,values);assert.equal(r.status,200);current=await r.json();return current.profiles.find(p=>p.id==='lake').settings};
  for(let mask=0;mask<8;mask++) {
    const bits=flags.map((_,i)=>Boolean(mask & (1<<i)));
    const s=await update('save',{...edit,...Object.fromEntries(flags.map((k,i)=>[k,bits[i]]))});
    assert.deepEqual(flags.map(k=>s[k]),bits);assert.equal(s.memory,bits.some(Boolean));
    assert.deepEqual([s.personLimit,s.memoryLimit,s.backgroundLimit],[100,42,9]);
  }
  await update('save',edit);
  const legacy={...edit,memory:true};for(const k of [...flags,'personLimit'])delete legacy[k];
  await update('save',legacy); // An older open tab can still save unrelated changes.
  for(const bad of [{memory:false},{memoryLimit:43}])assert.equal((await change('lake','save',{...legacy,...bad})).status,409);
  for(const action of ['reset','restore']){
    const s=await update(action);assert.deepEqual(flags.map(k=>s[k]),[false,true,false]);
    assert.deepEqual([s.personLimit,s.memoryLimit,s.backgroundLimit],[100,42,9]);assert.equal(s.memoryResetAt>0,action==='reset');
  }
  console.log('Eight independent switch states, retained counts, old clients, reset/restore and DM isolation verified.');
} finally { if(server) await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true}); }
