// Loaded explicitly only for an armed, plain owner-DM test. No modification to the provider request.
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {createConnection} from 'node:net';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  const dir=process.env.NIKITA_OWNER_INSPECTION_DIR;
  if(!dir || !path.isAbsolute(dir))return;
  let ticket='';
  pi.on('before_agent_start',event=>{
    ticket=''; if(String(event.prompt).trim().toLowerCase()!=='ok')return;
    try { const arm=path.join(dir,'armed'); if(Date.now()-statSync(arm).mtimeMs<600_000)ticket=readFileSync(arm,'utf8'); } catch { /* Not armed. */ }
  });
  pi.on('before_provider_request',async event=>{
    if(!ticket)return;
    const once=ticket;ticket='';
    try {
      const data=JSON.stringify({ticket:once,body:event.payload});
      if(Buffer.byteLength(data)>512*1024)return;
      await new Promise<void>(resolve=>{
        const s=createConnection(path.join(dir,'submit.sock'));
        const timer=setTimeout(()=>s.destroy(),500);
        s.once('connect',()=>s.end(data));s.once('error',()=>{});
        s.once('close',()=>{clearTimeout(timer);resolve();});
      });
    }catch { /* Capture must never change or block the owner's reply. */ }
  });
}
