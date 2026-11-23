// Real Pi CLI and owner-DM transport, synthetic Telegram input and loopback provider only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import express from 'express';
import {createOwnerRequestInspection} from '../server/owner-request-inspection.ts';
const run=promisify(execFile), tmp=await fs.mkdtemp('/tmp/pi-inspect-');
const base=tmp+'/state', agent=tmp+'/agent', data=tmp+'/data';
for(const dir of [base,agent,data])await fs.mkdir(dir,{mode:0o700});
const listen=async s=>{await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${s.address().port}`;};
const seen=[];
const provider=http.createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer fixture-only'){res.writeHead(401);res.end();return;}
  let raw='';for await(const b of req)raw+=b;seen.push(JSON.parse(raw));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const [delta,finish_reason] of [[{role:'assistant',content:'fixture reply'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  res.end('data: [DONE]\n\n');
});
const capture=createOwnerRequestInspection(base);const app=express();app.use(express.json());app.use('/inspection',capture.router);const panel=http.createServer(app);
try {
  const api=(await listen(panel))+'/inspection';const url=await listen(provider);
  const state=async()=>await (await fetch(api)).json();const post=async action=>await (await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})})).json();
  await fs.writeFile(agent+'/models.json',JSON.stringify({providers:{fixture:{baseUrl:url+'/v1',api:'openai-completions',models:[{id:'test',name:'test',contextWindow:100000,maxTokens:1024}]}}}));
  await fs.writeFile(agent+'/auth.json',JSON.stringify({fixture:{type:'api_key',key:'fixture-only'}}),{mode:0o600});
  await fs.writeFile(data+'/conversation-profiles.json',JSON.stringify({version:1,profiles:{owner_dm:{model:'fixture/test',memory:false,toolsOn:false,tailOn:false,basePrompt:'Inspection fixture'}}}));
  const turn=async code=>run(process.env.TEST_TELEGRAM_PYTHON||'python3',['-B','-c',`import asyncio,sys\nfrom types import SimpleNamespace as NS\nsys.path.insert(0,'telegram')\nimport instance\n${code}`],{timeout:30000,env:{PATH:process.env.PATH,HOME:tmp,NIKITA_INSTANCE_DIR:base,PI_WEB_TELEGRAM_DATA:data,PI_CODING_AGENT_DIR:agent,PI_WEB_PI_BIN:process.env.PI_WEB_PI_BIN||'pi'}});
  assert.equal((await state()).state,'off');assert.equal((await post('arm')).state,'armed');
  await turn("asyncio.run(instance.answer('ok',instance.owner_profile(),-123))");assert.equal((await state()).state,'armed');
  await turn("asyncio.run(instance.tool_turn(NS(raw_text='other',message=NS())))");assert.equal((await state()).state,'armed');
  const owner="asyncio.run(instance.tool_turn(NS(raw_text='ok',message=NS(reply_to_msg_id=None,media=None,fwd_from=None))))";
  await turn(owner);const captured=await state();assert.equal(captured.state,'captured');assert.deepEqual(captured.body,seen.at(-1));assert.ok(!JSON.stringify(captured.body).includes('fixture-only'));
  await turn(owner);assert.deepEqual(await state(),captured);assert.equal((await post('clear')).state,'off');assert.equal(seen.length,4);
  const ttlProbe=createOwnerRequestInspection(tmp+'/ttl',300);const short=express();short.use(express.json());short.use(ttlProbe.router);const srv=http.createServer(short);
  try{
    const loc=await listen(srv),arm=()=>fetch(loc,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"arm"}'});
    const state=async()=> (await (await fetch(loc)).json()).state;
    const push=ticket=>new Promise((ok,fail)=>{const s=net.createConnection(tmp+'/ttl/inspection/submit.sock');s.on('error',fail);s.on('close',ok);s.on('connect',()=>s.end(JSON.stringify({ticket,body:{test:true}})));});
    const ticket=()=>fs.readFile(tmp+'/ttl/inspection/armed','utf8');
    await arm();const stale=await ticket();await arm();await push(stale);assert.equal(await state(),'armed');await push(await ticket());assert.equal(await state(),'captured');
    await new Promise(r=>setTimeout(r,350));assert.equal(await state(),'off');await arm();await new Promise(r=>setTimeout(r,350));assert.equal(await state(),'off');
  }finally{ttlProbe.close();srv.closeAllConnections();await new Promise(r=>srv.close(r));}
  console.log('Verified provider payload equality, group exclusion, single use, stale tickets, clear and expiry.');
}finally{capture.close();for(const s of [provider,panel]){s.closeAllConnections();await new Promise(r=>s.close(r));}await fs.rm(tmp,{recursive:true,force:true});}
