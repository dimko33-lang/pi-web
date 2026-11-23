// Run on a prepared stock test host. Separate controller process; no live settings or provider calls.
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnAgent,rootAvailable,currentRootMode,setRootMode} from '../server/execution.ts';
const base='/root/PiWebRuntime',app=base+'/app',pi=base+'/pi-cli/node_modules/.bin/pi';
assert.equal(process.cwd(),app);assert.equal(process.env.PI_WEB_ROOT_QA,'isolated');assert.ok(rootAvailable);
const fixture=await fs.mkdtemp('/root/pi-browser-qa-'),sid=randomUUID(), expected=(await fs.readFile('/var/lib/pi-web-workspace/managed-v1','utf8')).trim();
let requests=0,toolVerified=false;
const server=http.createServer(async(req,res)=>{
  let data='';for await(const p of req)data+=p;
  if(req.headers.authorization!=='Bearer fixture-only'){res.writeHead(401);res.end();return;}
  const parsed=JSON.parse(data);requests++; const tool=parsed.messages.find(m=>m.role==='tool');
  if(tool){const result=JSON.stringify(tool.content);toolVerified=result.includes(`workspace-uid=${expected}`)&&result.includes('private-paths-hidden')&&result.includes('unprivileged');}
  const cmd='printf "workspace-uid=%s\\n" "$(id -u)"; test ! -e /root/.ssh && test ! -e /root/PiWebRuntime/remote-access/access-link.json && test ! -e /run/docker.sock && echo private-paths-hidden; grep -Eq "^NoNewPrivs:[[:space:]]*1$" /proc/self/status && echo unprivileged';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'qa',object:'chat.completion.chunk',model:'wo',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  if(!tool && requests===1){emit({role:'assistant',tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'bash',arguments:JSON.stringify({command:cmd})}}]});emit({},'tool_calls');}
  else{emit({role:'assistant',content:'done'});emit({},'stop');}
  res.end('data: [DONE]\n\n');
});
async function run(cmd,args,admin){return await new Promise((resolve,reject)=>{
  const c=spawnAgent(cmd,args,{cwd:app,detached:true,env:{...process.env,HOME:'/root',PI_CODING_AGENT_DIR:fixture},stdio:['ignore','pipe','pipe','pipe']},admin);let out='',err='';
  const timer=setTimeout(()=>{try{process.kill(-c.pid,'SIGKILL');}catch{}},60000);
  c.stdout.on('data',p=>out+=p);c.stderr.on('data',p=>err+=p);c.on('error',e=>{clearTimeout(timer);reject(e)});c.on('close',n=>{clearTimeout(timer);if(n!==0)reject(Error('Probe failed: '+err.slice(-600)));else resolve(out.trim());});
});}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/v1`;
  await fs.writeFile(fixture+'/models.json',JSON.stringify({providers:{fixture:{baseUrl:url,api:'openai-completions',models:[{id:'wo',name:'Fixture',contextWindow:100000,maxTokens:1024}]}}}));
  await fs.writeFile(fixture+'/auth.json',JSON.stringify({fixture:{type:'api_key',key:'fixture-only'}}),{mode:0o600});
  assert.equal(currentRootMode(),false);
  assert.equal(await run('/usr/bin/id',['-u'],false),expected);
  assert.equal(setRootMode(true),true);assert.equal(await run('/usr/bin/id',['-u'],true),'0');
  assert.equal(setRootMode(false),false);assert.equal(await run('/usr/bin/id',['-u'],false),expected);
  const args=['-p','--model','fixture/wo','--thinking','off','--mode','json','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--extension',app+'/server/pi-context-extension.ts','--extension',app+'/server/pi-vision.ts','--tools','bash','--session-id',sid,'--session-dir',app+'/sessions','Test sandbox permissions'];
  await run(pi,args,false);assert.ok(toolVerified,'Expected the actual Pi bash tool output from the fixture');
  console.log(`Actual child UID: ${expected} -> 0 -> ${expected}; Pi shell, credentials, private paths and no-new-privs verified offline.`);
}finally{
  setRootMode(false);server.closeAllConnections();await new Promise(r=>server.close(r));
  for(const f of await fs.readdir(app+'/sessions'))if(f.endsWith('_'+sid+'.jsonl'))await fs.unlink(app+'/sessions/'+f);
  await fs.rm(fixture,{recursive:true,force:true});
}
