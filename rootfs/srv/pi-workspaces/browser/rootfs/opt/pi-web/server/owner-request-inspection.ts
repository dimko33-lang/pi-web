// Single-use owner DM inspection. Only /run (tmpfs); no tokens, HTTP headers or session transcript logging.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';

export function createOwnerRequestInspection(dir = '/run/nikita-owner-json', ttl = 600000) {
  const arm = path.join(dir, 'armed'), result = path.join(dir, 'body.json'), socket = path.join(dir, 'submit.sock');
  const router = Router();
  const remove = (p: string) => fs.rmSync(p, {force:true});
  const clear = () => { remove(arm); remove(result); };
  const fresh = (p: string) => { try { const t = fs.statSync(p).mtimeMs + ttl; if (Date.now() < t) return t; remove(p); } catch {} return 0; };
  const state = () => { const expiresAt = fresh(result); if (expiresAt) return { state:'captured', expiresAt, body:JSON.parse(fs.readFileSync(result,'utf8')) }; const until = fresh(arm); return {state:until?'armed':'off', expiresAt:until}; };
  clear(); remove(socket);
  const server = net.createServer(s => {
    const chunks: Buffer[] = []; let size = 0;
    s.on('error', () => {}); s.setTimeout(1000, () => s.destroy());
    if (!fresh(arm)) { s.destroy(); return; }
    s.on('data', b => { size += b.length; if (size > 512*1024) s.destroy(); else chunks.push(b); });
    s.on('end', () => { try {
      if (!fresh(arm) || size > 512*1024) return;
      const {ticket, body} = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (ticket !== fs.readFileSync(arm, 'utf8') || !body || typeof body !== 'object' || Array.isArray(body)) return;
      fs.writeFileSync(result, JSON.stringify(body), {mode:0o600,flag:'wx'}); remove(arm);
    } catch { /* A stale ticket or incomplete socket write must not affect a turn. */ } });
  });
  let ready = false;
  server.on('error', () => { ready = false; });
  server.listen(socket, () => { fs.chmodSync(socket,0o660); ready = true; });
  setInterval(() => { fresh(arm); fresh(result); }, 10000).unref();
  router.use((_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  router.get('/', (_req,res) => res.json(state()));
  router.post('/', (req,res) => {
    if (!req.is('application/json')) return res.sendStatus(415);
    if (req.body?.action === 'clear') clear();
    else if (req.body?.action === 'arm') { if (!ready) return res.status(503).json({error:'Inspection is unavailable.'}); clear(); fs.writeFileSync(arm, randomUUID(), {mode:0o640}); fs.chmodSync(arm,0o640); }
    else return res.sendStatus(400);
    return res.json(state());
  });
  return router;
}
