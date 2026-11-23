// Synthetic red -> blue clips, real Pi CLI -> loopback provider. No Telegram session or subscription.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),require=createRequire(new URL('../telegram/media-decoder/package.json',import.meta.url));
globalThis.self={location:{href:'file:///decoder/'}};
const core=await require('@ffmpeg/core')({wasmBinary:await fs.readFile(require.resolve('@ffmpeg/core/wasm')),locateFile:s=>s});
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'nikita-motion-test-')), seen=[];
const provider=http.createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b; seen.push(JSON.parse(raw));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const [delta,finish_reason] of [[{role:'assistant',content:'ok'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'f',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  res.end('data: [DONE]\n\n');
});
try{
  for(const ext of ['mp4','gif']){
    core.reset();assert.equal(core.exec('-v','error','-f','lavfi','-i',"color=red:s=96x64:r=6:d=2,drawbox=color=blue:t=fill:enable='gte(t,1)'",'test.'+ext),0);
    await fs.writeFile(path.join(tmp,'test.'+ext),core.FS.readFile('test.'+ext));
  }
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  await fs.mkdir(tmp+'/agent');await fs.mkdir(tmp+'/state');await fs.mkdir(tmp+'/data');
  await fs.writeFile(tmp+'/agent/models.json',JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,api:'openai-completions',models:['vision','text'].map(id=>({id,name:id,input:id==='vision'?['text','image']:['text'],contextWindow:100000,maxTokens:128}))}}}));
  await fs.writeFile(tmp+'/agent/auth.json',JSON.stringify({fixture:{type:'api_key',key:'fixture-only'}}),{mode:0o600});
  const py=String.raw`import asyncio, os, sys
from pathlib import Path
from types import SimpleNamespace as NS
sys.path.insert(0,'telegram')
import instance
from motion_frames import sampled_inputs
base=Path(os.environ['HOME']); incoming=NS(raw_text='What changed?',chat_id=1)
class Clip:
    def __init__(self,ext):
        self.data=(base/('test.'+ext)).read_bytes();self.file=NS(size=len(self.data),mime_type={'mp4':'video/mp4','gif':'image/gif'}[ext]);self.reply_to_msg_id=None;self.chat_id=1
    async def download_media(self,file):file.write(self.data)
async def go():
    for ext in ['gif','mp4','text','foreign']:
        clip=Clip('gif' if ext=='gif' else 'mp4');incoming.message=clip
        if ext!='gif':
            incoming.message=NS(reply_to_msg_id=500);incoming.get_reply_message=lambda: asyncio.sleep(0,result=clip)
        if ext=='foreign':clip.chat_id=2
        instance.owner_profile=lambda:{'model':'fixture/'+('text' if ext=='text' else 'vision'),'toolsOn':False,'memory':False}
        assert await instance.tool_turn(incoming)==('ok',None)
    clip.file.size=5_000_001
    async with sampled_inputs(clip) as (files,note):assert not files and '5 MB' in note
    clip.file.size=12;clip.data=b'invalid file'
    async with sampled_inputs(clip) as (files,note):assert not files and 'not viewed' in note
asyncio.run(go())`;
  await run(process.env.TEST_TELEGRAM_PYTHON||'python3',['-B','-c',py],{timeout:90000,env:{PATH:process.env.PATH,HOME:tmp,NIKITA_INSTANCE_DIR:tmp+'/state',PI_WEB_TELEGRAM_DATA:tmp+'/data',PI_CODING_AGENT_DIR:tmp+'/agent',PI_WEB_PI_BIN:process.env.PI_WEB_PI_BIN||'pi'}});
  assert.equal(seen.length,4);
  for(const [i,req] of seen.entries()){
    const content=req.messages.at(-1).content;const images=Array.isArray(content)?content.filter(p=>p.type==='image_url'):[];
    assert.equal(images.length,i<2?1:0,`image input case ${i}`);
    if(i<2){const src=images[0].image_url.url.split(',')[1];core.FS.writeFile('received.jpg',Buffer.from(src,'base64'));core.reset();
      assert.equal(core.exec('-v','error','-i','received.jpg','-vf','scale=6:2','-f','rawvideo','-pix_fmt','rgb24','pixels'),0);
      const rgb=core.FS.readFile('pixels');assert.ok(rgb[0]>rgb[2]+80,'early red frame');assert.ok(rgb[35]>rgb[33]+80,'late blue frame');
      assert.ok(JSON.stringify(content).includes('What changed?'));
    }
    if(i===2)assert.ok(JSON.stringify(content).includes('omitted'));
  }
  console.log('GIF and same-chat MP4 reply -> ordered red/blue frames received by provider. Text-only and foreign reply: no images. Limits and invalid input verified.');
}finally{provider.closeAllConnections();await new Promise(r=>provider.close(r));await fs.rm(tmp,{recursive:true,force:true});}
