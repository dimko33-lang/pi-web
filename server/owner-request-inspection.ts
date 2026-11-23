// Reference single-use ticket + Unix socket protocol. The body stays in RAM, never in Save or logs.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Router} from 'express';

export function createOwnerRequestInspection(base: string, ttl = 600_000) {
  const dir = path.join(base, 'inspection');
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const st=fs.lstatSync(dir);
  if (!st.isDirectory() || st.uid!==process.getuid?.() || (st.mode & 0o077)) throw Error('Unsafe inspection directory');
  const arm=path.join(dir,'armed'), socket=path.join(dir,'submit.sock');
  let ticket='', expiresAt=0, body: Record<string,unknown> | null=null, ready=false;
  const clear=()=>{ticket=''; body=null; expiresAt=0; fs.rmSync(arm,{force:true});};
  const expire=()=>{if(expiresAt && Date.now()>=expiresAt) clear();};
  const state=()=>{expire(); return body ? {state:'captured',expiresAt,body} : ticket ? {state:'armed',expiresAt} : {state:'off'};};
  clear(); fs.rmSync(socket,{force:true});
  const server=net.createServer(s=>{
    expire(); if(!ticket){s.destroy();return;}
    const expected=ticket, chunks: Buffer[]=[]; let size=0;
    s.on('error',()=>{}); s.setTimeout(1000,()=>s.destroy());
    s.on('data',b=>{size+=b.length; if(size>512*1024){s.destroy();return;} chunks.push(b);});
    s.on('end',()=>{try {
      expire(); if(ticket!==expected || size>512*1024) return;
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(data.ticket!==ticket || !data.body || typeof data.body!=='object' || Array.isArray(data.body)) return;
      clear(); body=data.body; expiresAt=Date.now()+ttl;
    } catch { /* Inspection is optional; malformed submissions never affect a reply. */ }});
  });
  server.on('error',()=>{ready=false;});
  server.listen(socket,()=>{fs.chmodSync(socket,0o600);ready=true;});
  const timer=setInterval(expire,Math.min(ttl,10_000)).unref();
  const router=Router();router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',(_req,res)=>res.json(state()));
  router.post('/',(req,res)=>{
    if(!req.is('application/json'))return res.sendStatus(415);
    if(req.body?.action==='clear')clear();
    else if(req.body?.action==='arm'){
      if(!ready)return res.status(503).json({error:'Inspection is unavailable.'});
      clear();const next=randomUUID();fs.writeFileSync(arm,next,{mode:0o600,flag:'wx'});ticket=next;expiresAt=Date.now()+ttl;
    }else return res.sendStatus(400);
    return res.json(state());
  });
  return {router,close(){clearInterval(timer);clear();server.close();}};
}
