import { spawn } from 'node:child_process';
import { rootAvailable, rootEnabled, currentRootMode, setRootMode } from './execution.ts';
import { createChatLive } from './chat-live.ts';
import { createStreamDelivery } from './stream-delivery.ts';
import { createVision } from './vision.ts';
import { chatImages } from './chat-images.ts';
const chatLive = createChatLive();
import os from 'node:os';
import express from 'express';
import { createReasoningAccumulator } from './reasoning-accumulator.ts';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  checkRateLimit,
  verifyPassword,
  createSession,
  destroySession,
  isAuthenticated,
  requireAuth
} from './auth.ts';
import { omitSessionMessage, restoreSessionMessage } from './message-deletion.ts';
import { createTranscriptDeletion, isServerNotice } from './transcript-deletion.ts';
import { createSourceArchive } from './source-archive.ts';
import { createFilesRouter } from './files.ts';
import { askAgent, isBusy, clearBusy, resetSession, useSession, currentSession, sessionsDir, modelId, piContextConfig } from './agent.ts';
import { sessionFile, sessionFiles, readSession, sumFiles, usageForSession, costAsSonnet, listChats, readSessionMessages } from './usage.ts';
import { MODELS, DEFAULT_MODEL, loadSaved, setModel, availableModels, probeProviders, probeModels, startAutoRefresh } from './models.ts';
import { piContextStatus } from './pi-context.ts';
import { ChatThinking, chatThinking } from './chat-thinking.ts';
import { createConversationProfiles } from './conversation-profiles.ts';
import { getSession, setSession, getMessages, pushMessage, pushNote, updateLastAgent, clearMessages, fillMessages, restoreMessage, deleteMessage, deleteMessageByMatch, deleteMessageByAt, wipeAllMessages } from './history.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');
const PORT = Number(process.env.PORT || 5070);
const transcriptDeletion = createTranscriptDeletion(path.join(DATA_DIR, 'transcript-deletions.json'));
const vision = createVision({ origin: `http://127.0.0.1:${PORT}` });

const app = express();

app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Local-only browser entry: reject DNS rebinding and cross-origin writes.
app.use((req, res, next) => {
  const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(process.env.PI_WEB_ALLOWED_HOSTS || '').split(',').filter(Boolean)];
  if (!hosts.includes(req.headers.host || '')) return res.status(403).json({ error: 'Invalid host' });
  if (req.method !== 'GET' && req.headers.origin && !hosts.some(host => req.headers.origin === `${req.protocol}://${host}`)) {
    return res.status(403).json({ error: 'Invalid origin' });
  }
  next();
});

// The private access link establishes a browser session and removes the key
// from the address bar before loading assets or exposing any project API.
app.use(async (req, res, next) => {
  if (req.path === '/' && typeof req.query.key === 'string') {
    const rate = checkRateLimit(req);
    if (!rate.ok) return res.status(429).send('Too many login attempts. Try again later.');
    if (!await verifyPassword(req, req.query.key)) {
      destroySession(req, res);
      return res.status(401).send('Invalid access link.');
    }
    createSession(res);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect('/');
  }
  // This endpoint authenticates its own per-turn bearer capability; it has
  // no browser cookie. Its route also enforces loopback and token validity.
  if (req.path === '/api/vision/capture' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return next();
  if (!isAuthenticated(req)) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path === '/' && ['GET', 'HEAD'].includes(req.method)) {
      // A public metadata-only landing page lets link crawlers preview the app
      // without browser cookies. No chat HTML, assets, files or API are exposed.
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.type('html').send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>pi-web</title>
<meta name="description" content="Your private AI chat workspace.">

<meta property="og:type" content="website"><meta property="og:site_name" content="pi-web">
<meta property="og:title" content="pi-web"><meta property="og:description" content="Your private AI chat workspace.">

<meta name="twitter:card" content="summary"><meta name="twitter:title" content="pi-web">
<meta name="twitter:description" content="Your private AI chat workspace.">
</head><body style="background:#353536;color:#ddd;font:16px system-ui;padding:32px">
<h1>pi-web</h1><p>Open your private pi-web access link.</p></body></html>`);
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Authentication required.' });
    return res.status(401).type('html').send('<!doctype html><meta name="color-scheme" content="dark"><title>pi-web</title><body style="background:#000;color:#ccc;font:16px system-ui;padding:32px">Open your private pi-web access link.</body>');
  }
  next();
});

app.use('/files', await createFilesRouter({
  directory: path.join(DATA_DIR, 'uploads'), publicDirectory: PUBLIC,
  maxBytes: Number(process.env.PI_WEB_UPLOAD_MAX_MB || 1024) * 1024 ** 2
}));

// --- API ---

app.post('/api/vision/capture', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return res.status(403).json({ error: 'Local capture capability required' });
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    res.json(await vision.screenshot(token, req.body?.target, cookie => isAuthenticated({ cookies: { cl_sid: cookie } })));
  } catch (error) { res.status(403).json({ error: (error as Error).message }); }
});
app.get('/api/chat/images/:name', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).end();
  const file = chatImages.file(String(req.params.name));
  if (!file) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
});

// All app routes below the access-link boundary share the browser session.

app.post('/api/login', async (req, res) => {
  const limit = checkRateLimit(req);
  if (!limit.ok) {
    return res.status(429).json({ error: 'too many attempts', until: limit.until });
  }
  const ok = await verifyPassword(req, req.body?.password);
  if (!ok) return res.status(401).json({ error: 'invalid' });
  grantAll(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

/* Chat operations require the authenticated owner session. */
app.post('/api/chat', async (req, res) => {
  /* Require a valid session established by the access link. */
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Access key required' });
  }
  const expectedSession = req.body?.expectedSession;
  if (expectedSession !== undefined &&
      (typeof expectedSession !== 'string' || !expectedSession ||
       expectedSession !== currentSession() || expectedSession !== getSession())) {
    return res.status(409).json({ error: 'Conversation changed. Reload the chat before sending.' });
  }
  const isOwner = true;
  /* A stale browser must not unknowingly submit a task with different privileges. */
  if (req.body?.root !== undefined && req.body.root !== currentRootMode()) {
    return res.status(409).json({ error: 'Execution privileges changed. Refresh root status before sending.' });
  }

  /* Bound input length to prevent accidental context exhaustion. */
  const MAX_IN_OWNER = 6000;
  const raw = String(req.body?.message || '');
  const message = raw.slice(0, MAX_IN_OWNER).trim();
  if (!message) return res.status(400).json({ error: 'empty' });

  /* Reject overlapping turns instead of queuing them. */
  if (isBusy()) {
    return res.status(409).json({
      error: 'The model is busy with the previous request. Wait for its reply; messages are not queued.'
    });
  }

  const visionTurn = vision.beginTurn(req.cookies?.cl_sid);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const deliver = (event, data) => {
    if (event === 'beat') chatLive.update(data);
    if (event === 'progress') chatLive.update({ text: data.text });
    if (event === 'done') chatLive.finish({ text: data.reply, tools: data.tools, responseMeta: data.responseMeta });
    if (event === 'error') chatLive.finish({ error: data.message });
    if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const delivery = createStreamDelivery(deliver);
  const send = delivery.send;
  send('start', { busy: isBusy() });
  // Authenticated turns append to the shared transcript.
  if (isOwner) {
    pushMessage('me', message);
    pushMessage('agent', '');
    chatLive.begin(getMessages().at(-1)!.at);
    pushChatChanged('new-message');
  }

  /* Emit elapsed time and activity every two seconds, including silent reasoning. */
  const t0 = Date.now();
  let stage = 'thinking';
  let thinking = '';
  const reasoning = createReasoningAccumulator();
  let tools = [];
  /* Bound reasoning payload size on each heartbeat. */
  const THINK_CHARS = Number(process.env.PI_WEB_THINK_CHARS || 2000);
  let sentThink = 0;   // Reasoning characters already delivered.
  const beat = setInterval(() => {
    /* Send reasoning deltas plus a bounded snapshot for client recovery. */
    const full = thinking.slice(-THINK_CHARS);
    send('beat', {
      seconds: Math.round((Date.now() - t0) / 1000),
      stage,
      thinking: full,
      thinkingLen: thinking.length,
      tools
    });
  }, 2000);

  try {
    const onProgress = (partial) => send('progress', { text: partial });
    const onStage = (st) => {
      stage = st.stage || 'thinking';
      // Replace cumulative snapshots by segment; never append the same snapshot again.
      if (typeof st.thinking === 'string') {
        thinking = reasoning.update(st.thinkingSegment ?? 0, st.thinking);
      }
      // Flush immediately rather than waiting for the next heartbeat.
      send('beat', {
        seconds: Math.round((Date.now() - t0) / 1000),
        stage,
        thinking: thinking.slice(-THINK_CHARS),
        thinkingLen: thinking.length,
        tools
      });
    };
    const onTools = (list) => {
      tools = list;
      send('beat', {
        seconds: Math.round((Date.now() - t0) / 1000),
        stage, thinking: thinking.slice(-THINK_CHARS),
        thinkingLen: thinking.length, tools
      });
    };

    let responseMeta: any;
    /* Shared Memory is authoritative; old tabs cannot re-enable it per message. */
    const memorySetting = readSettings()?.memory;
    const opts = {
      onMetadata: meta => { responseMeta = meta; },
      /* Revocable permission for this turn; no image is attached automatically. */
      vision: visionTurn,
      memory: memorySetting === undefined ? req.body?.memory !== false : memorySetting !== false,
      /* Prompt and character settings are read from server storage by agent.ts. */
      /* Privileges come from server policy and saved state, never the message body. */
      root: currentRootMode(),
      onTools
    };
    const reply = await askAgent(message, onProgress, onStage, opts);
    if (thinking.trim()) tools.unshift({ id: 'reasoning', kind: 'reasoning', text: thinking, seconds: Math.round((Date.now() - t0) / 1000) });
    responseMeta = responseMeta ? { ...responseMeta, completedAt: Date.now() } : undefined;
    updateLastAgent(reply, tools, undefined, responseMeta);
    const saved = getMessages();
    send('done', { reply, tools, responseMeta, userAt: saved.at(-2)?.at, agentAt: saved.at(-1)?.at });
    /* Publish the completed turn to other connected clients. */
    pushChatChanged('turn-done');
  } catch (e) {
    updateLastAgent('Error: ' + (e.message || String(e)), undefined, 'server-error');
    send('error', { message: e.message || String(e) });
    pushChatChanged('turn-error');
  } finally {
    vision.endTurn(visionTurn?.token);
    clearInterval(beat);
    delivery.dispose();
    res.end();
  }
});

/* CHAT RECOVERY: persisted transcript and active turn for authenticated clients. */
app.get('/api/chat/history', (req, res) => {
  /* Disable caching so reconnects cannot display a stale transcript. */
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (!isAuthenticated(req)) {
    return res.status(401).json({ messages: [] });
  }
  res.json({ messages: getMessages(), active: chatLive.snapshot()?.active ? chatLive.snapshot() : null });
});

// Each subscriber receives the full current snapshot, including on reconnect.
app.get('/api/chat/live', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const unsubscribe = chatLive.subscribe(state => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(state)}\n\n`);
  });
  const ping = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 15000);
  res.on('close', () => { clearInterval(ping); unsubscribe(); });
});

/* Transcript edits require authentication and preserve Pi context consistency. */
function canEdit(req) {
  return isAuthenticated(req);
}
function deleteOneMessage(req, res) {
  if (!canEdit(req)) {
    return res.status(401).json({ error: 'auth required' });
  }
  if (isBusy()) return res.status(409).json({ error: 'Wait until the model finishes before deleting messages.' });
  const at = Number(req.body?.at || 0);
  const role = String(req.body?.role || '');
  const text = String(req.body?.text || '');
  const messages = getMessages();
  // Exact timestamps only: the old ten-second tolerance could delete a neighbor.
  let index = at > 0 ? messages.findIndex(m => m.at === at && (!role || m.role === role)) : -1;
  if (!at && text) {
    const matches = messages.map((m, i) => ({ m, i })).filter(({ m }) => m.text === text && (!role || m.role === role));
    if (matches.length === 1) index = matches[0].i;
  } else if (!at && !text && Number.isInteger(req.body?.index)) index = req.body.index;
  const message = messages[index];
  if (!message) return res.status(404).json({ error: 'Message not found. Reload the chat and try again.' });
  try {
    let undoToken = null;
    const file = sessionFile(sessionsDir(), currentSession());
    // Transcript-only notices have no corresponding native model message.
    if (!file || isServerNotice(message, readSessionMessages(file))) {
      undoToken = transcriptDeletion.record(currentSession(), message, index, messages.filter((_, i) => i !== index));
    } else if (message.role === 'me' || message.role === 'agent') {
      undoToken = omitSessionMessage(file, message, index).token;
    }
    const ok = deleteMessage(index);
    pushChatChanged('message-deleted');
    return res.json({ ok, index, undoToken });
  } catch (e) {
    return res.status(409).json({ error: (e as Error).message });
  }
}

app.get('/api/chat/msg/deletion-capability', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!canEdit(req)) return res.status(401).json({ error: 'auth required' });
  res.json({ contextDeletion: true, contextUndo: true });
});
app.post('/api/chat/msg/delete', deleteOneMessage);

/* Restore deleted transcript entries. */
app.post('/api/chat/msg/restore', (req, res) => {
  if (!canEdit(req)) {
    return res.status(401).json({ error: 'auth required' });
  }
  if (isBusy()) return res.status(409).json({ error: 'Wait until the model finishes.' });
  try {
    const token = req.body?.token;
    if (typeof token !== 'string') return res.status(400).json({ error: 'No deletion token for this session.' });
    const file = sessionFile(sessionsDir(), currentSession());
    if (!token.startsWith('web-') && !file) return res.status(400).json({ error: 'Model session not found.' });
    const restored = token.startsWith('web-')
      ? transcriptDeletion.restore(currentSession(), token, getMessages())
      : restoreSessionMessage(file!, token);
    restoreMessage(restored.message, restored.index);
    pushChatChanged('message-restored');
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});

/* Reset the shared transcript and start a new native session. */
app.post('/api/chat/wipe', (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ error: 'owner only' });
  if (isBusy()) return res.status(409).json({ error: 'Busy' });
  try {
    const removed = wipeAllMessages();
    pushChatChanged('wipe');
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/chat/reset', (req, res) => {
  if (isBusy()) return res.status(409).json({ error: 'Busy' });
  /* Starting a new shared session requires authentication. */
  if (!isAuthenticated(req)) {
    return res.status(403).json({ error: 'Only the owner can start a new chat' });
  }
  /* Keep the previous native session available in Resume. */
  const id = resetSession();
  setSession(id);           /* Persist the new transcript selection. */
  clearMessages();          /* Ensure the in-memory transcript is empty. */
  pushChatChanged('reset');
  res.json({ ok: true, session: id });
});

/* SESSION INDEX: retain existing hidden IDs for backward-compatible filtering.
   The active deletion endpoint removes session files, rather than hiding them. */
const HIDDEN_FILE = path.join(DATA_DIR, 'chats-hidden.json');
function readHidden(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8'));
    return Array.isArray(j) ? j.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
app.get('/api/chat/list', requireAuth, (req, res) => {
  if (!isAuthenticated(req)) {
    return res.json({ chats: [], current: null });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const hidden = new Set(readHidden());
    /* Include brief conversations rather than hiding recent sessions in Resume. */
    const chats = listChats(sessionsDir(), { minTurns: 0, limit: 200 })
      .filter((c) => !hidden.has(c.id));
    res.json({ chats, current: getSession() || currentSession() });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message, chats: [] });
  }
});

/* Delete the selected native session file. */
app.post('/api/chat/delete', requireAuth, (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ error: 'Authentication required.' });
  if (isBusy()) return res.status(409).json({ error: 'Wait until the model finishes before deleting a conversation.' });
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'Missing ID' });
  /* Reject path traversal: session IDs must be plain names. */
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const file = sessionFile(sessionsDir(), id);
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    const activeDeleted = id === currentSession() || id === getSession();
    if (activeDeleted) {
      const nextSession = resetSession();
      setSession(nextSession);
      pushChatChanged('conversation-deleted');
    }
    res.json({ ok: true, activeDeleted });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/* Resume an existing native Pi session. */
app.post('/api/chat/open', requireAuth, (req, res) => {
  if (!isAuthenticated(req)) {
    return res.status(403).json({ error: 'Owner access required' });
  }
  if (isBusy()) return res.status(409).json({ error: 'Busy' });
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'Missing ID' });
  try {
    useSession(id);
    setSession(id);
    /* Hydrate the transcript from the native session. */
    const file = sessionFile(sessionsDir(), id);
    const msgs = file ? readSessionMessages(file) : [];
    fillMessages(msgs.map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.tools ? { tools: m.tools } : {}) })));
    res.json({ ok: true, session: id, messages: msgs.length });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/* MODEL SELECTION: catalog availability and the actual execution model. */
app.get('/api/chat/models', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    current: modelId(),
    default: DEFAULT_MODEL,
    /* Cached availability, highest combined price first. */
    models: availableModels()
  });
});

app.get('/api/chat/thinking', requireAuth, async (_req, res) => {
  try { res.json(await chatThinking.get(modelId(), piContextConfig())); }
  catch (e) { res.status(503).json({ error: (e as Error).message }); }
});
app.post('/api/chat/thinking', requireAuth, async (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Authentication required' });
  const model = modelId();
  if (req.body?.model !== model) return res.status(409).json({ error: 'Model changed' });
  try { res.json(await chatThinking.set(model, req.body?.level, piContextConfig())); }
  catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

/* A model change affects the next request, not the already-running Pi process.
   Keep the current session and allow switching while a request is active. */
app.post('/api/chat/model', (req, res) => {
  const id = String(req.body?.model || '');
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Access key required' });
    const cur = setModel(id);
    /* Model changes preserve the native session and its conversation context. */
    res.json({ ok: true, current: cur, session: currentSession() });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/* Cancel through the shared process-group lifecycle; keep the lock until exit. */
app.post(['/api/chat/stop', '/api/chat/unlock'], requireAuth, (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ error: 'Owner access required' });
  clearBusy();
  res.json({ ok: true, busy: isBusy(), stopping: isBusy() });
});

/* data/settings.json owns shared settings across devices.
   Browser storage is a startup cache, not the source of truth. */
const SETTINGS_FILE = path.join(DATA_DIR, 'browser-settings.json');
const TG_DATA_DIR = process.env.PI_WEB_TELEGRAM_DATA || DATA_DIR;
const TG_DEFAULTS_FILE = path.join(TG_DATA_DIR, 'settings.json');
const tgThinking = new ChatThinking(path.join(TG_DATA_DIR, 'chat-thinking.json'));
const SETTINGS_DEF = { customPrompt: '', character: '', memory: true, systemPrompt: true, root: false,
  /* How many earlier messages Telegram contexts may include (100 or 200). */
  memoryLimit: 200,
  /* Per-chat tail notes: appended to the very end of each Telegram request. */
  tailPiwep: '', tailDebri: '', tailLightcone: '', tailDirect: '',
  /* Enabled switch lives apart from the text so a note can be toggled without editing. */
  tailPiwepOn: true, tailDebriOn: true, tailLightconeOn: true, tailDirectOn: true,
  /* Per-chat speaking permission, not a personality: Telegram reads it each message. */
  lightconeReplies: true, debriReplies: true };

function readSettings(file = SETTINGS_FILE): any | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeSettings(body: any) {
  const cur = readSettings() || { ...SETTINGS_DEF };
  const str = (v: any, n: number) => {
    const text = String(v ?? '');
    if (text.length > n) throw new RangeError('Character setting exceeds ' + n + ' UTF-16 units');
    return text;
  };
  const next = {
    /* Preserve omitted fields so toggle updates cannot erase shared prompts.
       agent.ts reads the persisted instructions for each turn. */
    customPrompt: body?.customPrompt === undefined ? str(cur.customPrompt, 20000) : str(body.customPrompt, 20000),
    character: body?.character === undefined ? str(cur.character, 8000) : str(body.character, 8000),
    tailPiwep: body?.tailPiwep === undefined ? str(cur.tailPiwep, 4000) : str(body.tailPiwep, 4000),
    tailPiwepOn: body?.tailPiwepOn === undefined ? cur.tailPiwepOn !== false : body.tailPiwepOn !== false,
    tailDebriOn: body?.tailDebriOn === undefined ? cur.tailDebriOn !== false : body.tailDebriOn !== false,
    tailLightconeOn: body?.tailLightconeOn === undefined ? cur.tailLightconeOn !== false : body.tailLightconeOn !== false,
    tailDirectOn: body?.tailDirectOn === undefined ? cur.tailDirectOn !== false : body.tailDirectOn !== false,
    tailDebri: body?.tailDebri === undefined ? str(cur.tailDebri, 4000) : str(body.tailDebri, 4000),
    tailLightcone: body?.tailLightcone === undefined ? str(cur.tailLightcone, 4000) : str(body.tailLightcone, 4000),
    tailDirect: body?.tailDirect === undefined ? str(cur.tailDirect, 4000) : str(body.tailDirect, 4000),
    memory: body?.memory === undefined ? cur.memory !== false : body.memory !== false,
    /* Preserve omitted permissions so a Memory click cannot silently re-enable a chat. */
    lightconeReplies: body?.lightconeReplies === undefined
      ? cur.lightconeReplies !== false : body.lightconeReplies !== false,
    debriReplies: body?.debriReplies === undefined
      ? cur.debriReplies !== false : body.debriReplies !== false,
    systemPrompt: body?.systemPrompt === undefined ? cur.systemPrompt !== false : body.systemPrompt !== false,
    root: body?.root === undefined ? currentRootMode() : setRootMode(body.root),
    memoryLimit: (body?.memoryLimit === undefined ? Number(cur.memoryLimit) || 200 : Number(body.memoryLimit))
      === 100 ? 100 : 200,
    memoryEpoch: cur.memoryEpoch || 'initial',
    memoryResetAt: Number(cur.memoryResetAt) || 0,
    at: Date.now()
  };
  if (next.memory !== (cur.memory !== false)) {
    next.memoryEpoch = crypto.randomUUID();
    next.memoryResetAt = Date.now();
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  /* Browser-only settings: publish one complete snapshot. */
  const temporary = SETTINGS_FILE + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, SETTINGS_FILE);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Rename already removed it. */ }
  }
  return next;
}

app.use('/api/conversation-profiles', requireAuth, createConversationProfiles({
  directory: TG_DATA_DIR,
  basePrompt: () => {
    const source = process.env.PI_WEB_TELEGRAM_BASE || process.env.PI_WEB_SHARED_SYSTEM_PROMPT;
    if (!source) throw Error('Shared base prompt is not configured');
    return fs.readFileSync(source, 'utf8');
  },
  models: () => {
    const enabled: string[] = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'models.json'), 'utf8'));
    return MODELS.map(model => model.id).filter(id => enabled.includes(id));
  },
  thinking: model => tgThinking.get(model, piContextConfig()),
  notice: entry => entry.enabledKey && (readSettings(TG_DEFAULTS_FILE) || {})[entry.enabledKey] === false
    ? 'The main chat switch is off. Enable it in Chat to allow replies.' : '',
  defaults: entry => {
    const saved = { ...SETTINGS_DEF, ...(readSettings(TG_DEFAULTS_FILE) || {}) };
    const tgModel = loadSaved(path.join(TG_DATA_DIR, 'model.txt'));
    let thinking: Record<string, string> = {};
    try { thinking = JSON.parse(fs.readFileSync(path.join(TG_DATA_DIR, 'chat-thinking.json'), 'utf8')); } catch { /* No saved effort. */ }
    const privateConversation = entry.kind === 'private' || entry.kind === 'private_default';
    let modes: Record<string, string> = {};
    try { modes = JSON.parse(fs.readFileSync(path.join(TG_DATA_DIR, 'addressing.json'), 'utf8')).chatModes || {}; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { model: tgModel, thinking: thinking[tgModel] || '', systemPrompt: saved.systemPrompt !== false,
      character: saved.character, customPrompt: saved.customPrompt,
      tail: saved[entry.tailKey] || '', tailOn: saved[entry.tailKey + 'On'] !== false,
      memory: saved.memory !== false, memoryLimit: Math.min(100, saved.memoryLimit),
      backgroundLimit: privateConversation ? 0 : entry.backgroundLimit ?? 100,
      replyMode: privateConversation ? 'all' : modes[String(entry.chatId)] || 'mention_reply',
      memoryEpoch: saved.memoryEpoch || 'initial', memoryResetAt: saved.memoryResetAt || 0 };
  }
}));
app.get('/profiles', requireAuth, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC, 'conversation-profiles.html'));
});

app.get('/api/settings', requireAuth, (req, res) => {
  const saved = readSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, exists: !!saved,
    capabilities: { root: rootAvailable, tools: true }, busy: isBusy(),
    settings: { ...SETTINGS_DEF, ...(saved || {}), root: currentRootMode() } });
});

app.post('/api/settings', requireAuth, (req, res) => {
  if (['character', 'customPrompt', 'systemPrompt', 'tailPiwep', 'tailDebri', 'tailLightcone', 'tailDirect',
       'tailPiwepOn', 'tailDebriOn', 'tailLightconeOn', 'tailDirectOn']
      .some(key => req.body?.[key] !== undefined)
      && req.body?.personalitySchema !== 1) {
    return res.status(409).json({ error: 'Reload this page before changing shared personality settings' });
  }
  if (req.body?.root === true && !rootAvailable) {
    return res.status(403).json({ error: 'Server administration is unavailable' });
  }
  if (req.body?.memoryLimit !== undefined && ![100, 200].includes(Number(req.body.memoryLimit))) {
    return res.status(400).json({ error: 'Memory window must be 100 or 200 messages' });
  }
  if (isBusy() && req.body?.memory !== undefined
      && (req.body.memory !== false) !== ((readSettings() || SETTINGS_DEF).memory !== false)) {
    return res.status(409).json({ error: 'Wait for the active task before resetting memory' });
  }
  if (isBusy() && req.body?.root !== undefined
      && rootEnabled(req.body.root) !== currentRootMode()) {
    return res.status(409).json({ error: 'Wait for the active task before changing root' });
  }
  try {
    const before = (readSettings() || SETTINGS_DEF).memory !== false;
    const settings = writeSettings(req.body);
    if (settings.memory !== before) {
      const id = resetSession();
      setSession(id);
      clearMessages();
      pushChatChanged('reset');
    }
    res.json({ ok: true, capabilities: { root: rootAvailable, tools: true }, settings });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/* Forget the conversation: a new epoch whose checkpoint is 'now'. */
app.post('/api/memory/new', requireAuth, (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ error: 'Owner access required' });
  if (isBusy()) return res.status(409).json({ error: 'Wait for the active task' });
  const current = readSettings() || { ...SETTINGS_DEF };
  const next = { ...current, memory: true, memoryEpoch: crypto.randomUUID(), memoryResetAt: Date.now(), at: Date.now() };
  try {
    const temporary = SETTINGS_FILE + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, SETTINGS_FILE);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  const id = resetSession();
  setSession(id);
  clearMessages();
  pushChatChanged('reset');
  res.json({ ok: true, settings: next, session: id });
});

/* Re-attach the retained history: a new epoch that starts from the beginning. */
app.post('/api/memory/restore', requireAuth, (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ error: 'Owner access required' });
  if (isBusy()) return res.status(409).json({ error: 'Wait for the active task' });
  // Owner chose to restore the previous context instead of starting with an empty window.
  const current = readSettings() || { ...SETTINGS_DEF };
  const next = { ...current, memory: true, memoryEpoch: crypto.randomUUID(), memoryResetAt: 0, at: Date.now() };
  try {
    const temporary = SETTINGS_FILE + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, SETTINGS_FILE);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  const id = resetSession();
  setSession(id);
  clearMessages();
  pushChatChanged('reset');
  res.json({ ok: true, settings: next, session: id });
});

app.get('/api/chat/usage', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    /* Keep current-session usage separate from all-time totals. */
    const dir = sessionsDir();
    const active = currentSession();
    const selectedModel = modelId();
    const list = sessionFiles(dir);

    // Current-session status metrics.
    const cur = usageForSession(dir, active);

    // Aggregate totals for the tooltip.
    const all = sumFiles(list);

    // Models contributing to current-session totals.
    const perModel: Record<string, number> = {};
    const curFile = sessionFile(dir, active);
    if (curFile) {
      for (const [k, v] of Object.entries(readSession(curFile).byModel)) {
        perModel[k] = (perModel[k] || 0) + v.cost;
      }
    }

    const contextUsage = await piContextStatus.read(active, selectedModel, curFile, piContextConfig(), isBusy());
    const thinkingState = await chatThinking.get(selectedModel, piContextConfig());
    // Do not deliver an old model/session snapshot after an asynchronous restoration.
    if (active !== currentSession() || selectedModel !== modelId()) {
      res.json({ ok: false });
      return;
    }
    res.json({
      ok: true,
      session: active,
      model: selectedModel,
      thinking: thinkingState.level,
      sessions: list.length,
      perModel,
      // Reference-model estimate for current-session tokens.
      costSonnet: costAsSonnet(cur),
      // All-time tooltip totals.
      allTime: {
        cost: Number(all.cost.toFixed(4)),
        tokens: all.tokens,
        turns: all.turns,
        costSonnet: Number(costAsSonnet(all).toFixed(2))
      },
      ...cur,
      context: contextUsage.tokens,
      contextWindow: contextUsage.contextWindow,
      contextPercent: contextUsage.percent
    });
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message });
  }
});



app.get('/api/chat/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: isAuthenticated(req) });
});

/* Password or access-link login establishes the owner session. */
function grantAll(req, res) {
  createSession(res);
}

// Push source-change notifications to connected browsers.
// File-change events avoid browser polling.
const fileListeners = new Set();

function pushFileChanged(reason) {
  const payload = { at: Date.now(), reason: reason || 'change' };
  for (const res of fileListeners) {
    try {
      res.write('event: file\ndata: ' + JSON.stringify(payload) + '\n\n');
    } catch { /* Client disconnected. */ }
  }
}

/* Broadcast transcript changes to authenticated control-panel tabs. */
function pushChatChanged(reason: string, text = '') {
  const payload = { at: Date.now(), reason: reason || 'chat', text };
  for (const res of fileListeners) {
    try {
      res.write('event: chat\ndata: ' + JSON.stringify(payload) + '\n\n');
    } catch { /* Client disconnected. */ }
  }
}

app.get('/api/watch', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // Disable nginx response buffering.
  res.flushHeaders?.();
  fileListeners.add(res);

  // Confirm the channel immediately.
  res.write('event: ready\ndata: {}\n\n');
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* ignore */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    fileListeners.delete(res);
  });
});


let exportingSource = false;
app.get('/api/project/download/source', async (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Authentication required.' });
  if (isBusy()) return res.status(409).json({ error: 'Wait until the agent finishes before saving the project.' });
  if (exportingSource) return res.status(409).json({ error: 'A backup is already being created.' });
  exportingSource = true;
  try {
    const archive = await createSourceArchive(ROOT_DIR);
    res.setHeader('Cache-Control', 'no-store');
    res.download(archive.file, archive.name, () => { void archive.cleanup(); exportingSource = false; });
  } catch (error) {
    exportingSource = false;
    if (!res.headersSent) res.status(500).json({ error: 'Could not create the source backup.' });
    console.error('[source-backup]', error);
  }
});

app.get('/api/version', (_req, res) => res.json({ version: 'standalone-chat' }));
app.use(express.static(PUBLIC, { index: false, etag: false, lastModified: false }));
app.get('/', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).send('Authentication required');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC, 'chat.html'));
});
app.listen(PORT, '127.0.0.1', () => console.log(`Pi Chat on http://127.0.0.1:${PORT}/`));
