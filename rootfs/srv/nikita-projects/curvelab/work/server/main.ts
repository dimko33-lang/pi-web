import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { editorAuth } from './editor-auth.ts';
import { createCodeBackups } from './code-backups.ts';
import { startSnapshots, listSnapshots, restoreSnapshot, setBaseline } from './snapshots.ts';
import { touchPresence, dropPresence, listPresence, onPresence, takeLead, dropLead, whoLeads, keepLead } from './presence.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PROJECT = path.join(ROOT, 'project');
const PORT = Number(process.env.PORT || 5080);
const rawBase = process.env.EDITOR_BASE_PATH ?? '/lab';
if (rawBase !== '/' && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(rawBase)) throw new Error('Invalid EDITOR_BASE_PATH');
const BASE = rawBase === '/' ? '' : rawBase.replace(/\/$/, '');
const exec = promisify(execFile);
const app = express();
app.disable('x-powered-by');
app.enable('strict routing');
app.set('trust proxy', 'loopback');
const editor = express.Router({ strict: true });
editor.use(editorAuth(BASE));
editor.use(express.json({ limit: '4mb', type: ['application/json', 'text/plain'] }));

// Editor events never include panel conversations, models or provider state.
const clients = new Set<express.Response>();
function emit(event: string, data: unknown = {}) {
  for (const res of clients) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); }
  }
}
editor.get('/api/watch', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// Preserve the existing shared-document wire format independently of Live camera leases.
const SCENE = path.join(DATA, 'scene-live.json');
let sceneAuthor = '';
let sceneAt = 0;
let sceneLeader = '';
let sceneLeaderAt = 0;
function leaderAlive() {
  if (sceneLeader && Date.now() - sceneLeaderAt >= 20000) sceneLeader = '';
  return sceneLeader;
}
function readScene() {
  try { return JSON.parse(fs.readFileSync(SCENE, 'utf8')); } catch { return null; }
}
editor.get('/api/scene', (req, res) => {
  const leader = leaderAlive();
  const me = String(req.query.client || '');
  res.json({ ok: true, scene: readScene(), author: sceneAuthor, at: sceneAt, leader, amLeader: !!me && leader === me, viewOnly: !!leader && leader !== me });
});
editor.post('/api/scene/lead', (req, res) => {
  const client = String(req.body?.client || '');
  if (!client) return res.status(400).json({ error: 'Missing client' });
  const leader = leaderAlive();
  if (req.body?.on) {
    if (!leader || leader === client) {
      sceneLeader = client; sceneLeaderAt = Date.now();
      return res.json({ ok: true, leader: client, took: true, viewOnly: false });
    }
    return res.json({ ok: true, leader, took: false, viewOnly: true });
  }
  if (sceneLeader === client) { sceneLeader = ''; sceneLeaderAt = 0; }
  res.json({ ok: true, leader: sceneLeader, took: false, viewOnly: false });
});
editor.post('/api/scene', (req, res) => {
  const scene = req.body?.scene;
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return res.status(400).json({ error: 'Missing scene' });
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(SCENE + '.tmp', JSON.stringify(scene));
    fs.renameSync(SCENE + '.tmp', SCENE);
  } catch { return res.status(503).json({ error: 'Scene could not be saved' }); }
  sceneAuthor = String(req.body?.client || '');
  sceneAt = Date.now();
  sceneLeader = sceneAuthor; sceneLeaderAt = sceneAt;
  emit('scene', { at: sceneAt });
  res.json({ ok: true });
});

// These are the existing editor presence and presenter-lease owners, not panel plugins.
editor.post('/api/presence', (req, res) => {
  const cid = String(req.body?.cid || '');
  if (cid) keepLead(cid);
  res.json({ ok: true, peers: touchPresence({ cid, who: String(req.body?.who || ''), panel: req.body?.panel, tool: req.body?.tool, view: req.body?.view, cursor: req.body?.cursor }) });
});
editor.get('/api/presence', (_req, res) => res.json({ ok: true, peers: listPresence() }));
editor.post('/api/presence/take', (req, res) => {
  const cid = String(req.body?.cid || '');
  if (!cid) return res.status(400).json({ error: 'Missing cid' });
  if (!takeLead(cid)) return res.status(409).json({ error: 'busy', leader: whoLeads().cid });
  res.json({ ok: true, leader: cid });
});
editor.post('/api/presence/release', (req, res) => { dropLead(String(req.body?.cid || '')); res.json({ ok: true, leader: whoLeads().cid }); });
editor.get('/api/presence/leader', (_req, res) => res.json({ leader: whoLeads().cid }));
editor.post('/api/presence/leave', (req, res) => { dropPresence(String(req.body?.cid || '')); res.json({ ok: true }); });
editor.get('/api/presence/watch', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (peers: unknown, leader = whoLeads().cid) => res.write(`data: ${JSON.stringify({ peers, leader })}\n\n`);
  send(listPresence());
  const off = onPresence(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); off(); });
});

const backups = createCodeBackups(ROOT);
editor.get('/api/project/mtime', async (_req, res) => {
  try { res.json({ ok: true, ...await backups.ensure() }); }
  catch (error) { res.status(503).json({ ok: false, backup: backups.latest(), error: String(error) }); }
});
editor.get('/api/project/checkpoint/:name', (req, res) => {
  const file = backups.file(String(req.params.name));
  if (!file) return res.status(404).json({ error: 'Backup not found' });
  res.download(file, path.basename(file));
});
editor.get('/api/project/download/source', async (_req, res) => {
  try {
    const meta = await backups.ensure();
    res.download(backups.file(meta.name)!, meta.name);
  } catch (error) { res.status(503).json({ error: String(error) }); }
});
// Recovery covers this editor only. It must never archive another app or host credentials.
editor.get('/api/project/download', async (_req, res) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'curvelab-editor-recovery-'));
  const name = `curvelab-editor-recovery-${Date.now()}.tar.gz`;
  const archive = path.join(temp, name);
  const cleanup = () => fs.rmSync(temp, { recursive: true, force: true });
  try {
    await exec('tar', ['-czf', archive, '--exclude=./node_modules', '--exclude=./data/code-backups', '--exclude=./.git', '--exclude=./.env', '--exclude=./.env.*', '-C', ROOT, '.']);
    res.download(archive, name, cleanup);
  } catch (error) { cleanup(); if (!res.headersSent) res.status(503).json({ error: String(error) }); }
});
editor.get('/api/snapshots', (req, res) => res.json({ snapshots: listSnapshots(Number(req.query.limit) || 50) }));
editor.post('/api/baseline', (_req, res) => {
  try { res.json({ ok: true, ...setBaseline() }); } catch (error) { res.status(400).json({ error: String(error) }); }
});
editor.post('/api/restore', (req, res) => {
  try {
    const restored = restoreSnapshot(String(req.body?.id || ''), Array.isArray(req.body?.files) ? req.body.files.map(String) : undefined);
    emit('editor'); res.json({ ok: true, restored });
  } catch (error) { res.status(400).json({ error: String(error) }); }
});

editor.get('/', async (_req, res) => {
  const html = await fs.promises.readFile(path.join(PROJECT, 'curvelab.html'), 'utf8');
  res.vary('Cookie').type('html').send(res.locals.editorOwner ? html : html.replace(/<!-- editor-owner:start -->[\s\S]*?<!-- editor-owner:end -->/g, ''));
});
editor.get('/loopform', (_req, res) => res.redirect(308, BASE + '/loopform/'));
editor.get('/loopform/', (_req, res) => res.sendFile(path.join(PUBLIC, 'loopform.html')));
editor.get('/skeleton', (_req, res) => res.redirect(308, BASE + '/skeleton/'));
editor.get('/skeleton/', (_req, res) => res.sendFile(path.join(PUBLIC, 'shell.html')));
editor.use('/editor', express.static(path.join(PUBLIC, 'editor'), { index: false, etag: false, lastModified: false }));
editor.get('/presence.js', (_req, res) => res.sendFile(path.join(PUBLIC, 'presence.js')));
// No general source-directory static serving or leftover chat routes.
editor.use((_req, res) => res.status(404).json({ error: 'Not found' }));
if (BASE) app.get(BASE, (_req, res) => res.redirect(308, BASE + '/'));
app.use(BASE || '/', editor);
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (!res.headersSent) res.status(400).json({ error: error.message });
});

// Keep source-change delivery; do not reload or join the editor from a panel process.
let signatures = '';
const watch = setInterval(() => {
  const files = [path.join(PROJECT, 'curvelab.html'), path.join(PUBLIC, 'loopform.html'), path.join(PUBLIC, 'shell.html'), path.join(PUBLIC, 'presence.js'), ...fs.readdirSync(path.join(PUBLIC, 'editor')).map(name => path.join(PUBLIC, 'editor', name))];
  const next = files.map(file => { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}`; }).join(';');
  if (signatures && next !== signatures) emit('editor');
  signatures = next;
}, 1500);
watch.unref();
const checkpoint = setInterval(() => backups.ensure().catch(error => console.warn('[editor-backup]', String(error))), 30000);
checkpoint.unref();
const snapshots = startSnapshots();
app.listen(PORT, '127.0.0.1', () => console.log(`CurveLab editor: http://127.0.0.1:${PORT}${BASE}/ (snapshots: ${snapshots})`));
