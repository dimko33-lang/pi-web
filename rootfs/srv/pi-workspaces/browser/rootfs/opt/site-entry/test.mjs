import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'site-entry-test-'));
const servers = [];
let child;
async function app(cookie, key) {
  let logins = 0;
  let checkStatus = null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/check') {
      const valid = (req.headers.cookie || '').split(';').some(item => item.trim() === cookie + '=native');
      res.writeHead(checkStatus ?? (valid ? 200 : 401)); return res.end();
    }
    if (url.searchParams.get('key') !== key) { res.writeHead(401); return res.end(); }
    assert.match(req.headers.host, /^127\.0\.0\.1:\d+$/);
    assert.equal(req.headers['x-forwarded-proto'], 'https');
    logins++;
    res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookie}=native; Path=${cookie === 'chat_sid' ? '/' : '/lab/'}; HttpOnly; Secure; SameSite=Lax` });
    res.end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); servers.push(server);
  return { server, url: `http://127.0.0.1:${server.address().port}/`, logins: () => logins,
    setCheckStatus: value => { checkStatus = value; } };
}
async function stop(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
try {
  const chat = await app('chat_sid', 'chat-key');
  const editor = await app('editor_sid', 'editor-key');
  const config = { key: 'original-key', apps: [
    { path: '/', url: chat.url, key: 'chat-key', cookie: 'chat_sid', check: '/check' },
    { path: '/lab/', url: editor.url, key: 'editor-key', cookie: 'editor_sid', check: '/check' },
  ] };
  const file = path.join(temp, 'config.json'); await fs.writeFile(file, JSON.stringify(config));
  const reserve = http.createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await stop(reserve);
  child = spawn(process.execPath, [new URL('./main.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), SITE_ENTRY_CONFIG: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
  const base = `http://127.0.0.1:${port}`;
  const get = (url, headers = {}) => fetch(base + url, { redirect: 'manual', headers });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(logs);
    try { if ((await get('/_site/navigation.js')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal((await get('/?key=wrong')).status, 401);
  assert.equal(chat.logins(), 0); assert.equal(editor.logins(), 0);
  assert.equal((await get('/?key=original-key&key=extra')).status, 401);
  const login = await get('/?key=original-key');
  assert.equal(login.status, 303); assert.equal(login.headers.get('location'), '/');
  const cookies = login.headers.getSetCookie(); assert.equal(cookies.length, 2);
  assert.ok(cookies.some(cookie => cookie.startsWith('chat_sid='))); assert.ok(cookies.some(cookie => cookie.startsWith('editor_sid=')));
  assert.ok(!login.headers.get('location').includes('key='));
  const repeat = await get('/?key=original-key', { cookie: cookies.map(cookie => cookie.split(';')[0]).join('; ') });
  assert.equal(repeat.status, 303); assert.equal(repeat.headers.getSetCookie().length, 0);
  assert.equal(chat.logins(), 1); assert.equal(editor.logins(), 1);
  // A real root request sends the root cookie, not the editor's /lab/-scoped cookie.
  const scopedRepeat = await get('/?key=original-key', { cookie: 'chat_sid=native' });
  assert.equal(scopedRepeat.headers.getSetCookie().length, 1);
  assert.ok(scopedRepeat.headers.getSetCookie()[0].startsWith('editor_sid='));
  assert.equal(chat.logins(), 1); assert.equal(editor.logins(), 2);
  assert.equal((await get('/?key=original-key&next=https://untrusted.example')).headers.get('location'), '/');
  // A password-only chat login can bootstrap the editor without another key.
  const bridgeHeaders = { 'x-site-editor-session': '1', cookie: 'chat_sid=native' };
  const beforeBridge = editor.logins();
  const bridged = await get('/lab/', bridgeHeaders);
  assert.equal(bridged.status, 303); assert.equal(bridged.headers.get('location'), '/lab/');
  assert.equal(bridged.headers.getSetCookie().length, 1);
  assert.ok(bridged.headers.getSetCookie()[0].startsWith('editor_sid='));
  assert.equal(editor.logins(), beforeBridge + 1);
  const existing = await get('/lab/', { ...bridgeHeaders, cookie: 'chat_sid=native; editor_sid=native' });
  assert.equal(existing.status, 303); assert.equal(existing.headers.getSetCookie().length, 0);
  const afterBridge = editor.logins();
  for (const cookie of ['', 'chat_sid=forged', 'chat_sid=native-forged', 'editor_sid=native']) {
    const denied = await get('/lab/', { 'x-site-editor-session': '1', cookie });
    assert.equal(denied.status, 401); assert.equal(denied.headers.getSetCookie().length, 0);
  }
  for (const target of ['/lab/api/private', '/lab/unregistered/', '/lab/?key=wrong', '/', '//untrusted.example/']) {
    const denied = await get(target, bridgeHeaders);
    assert.equal(denied.status, 401); assert.equal(denied.headers.getSetCookie().length, 0);
  }
  assert.equal((await fetch(base + '/lab/', { method: 'POST', headers: bridgeHeaders, redirect: 'manual' })).status, 401);
  for (const status of [302, 401, 500]) {
    chat.setCheckStatus(status);
    assert.equal((await get('/lab/', bridgeHeaders)).status, 401);
  }
  chat.setCheckStatus(null);
  assert.equal(editor.logins(), afterBridge);
  for (const target of ['/lab/', '/lab/?next=https://untrusted.example']) {
    const response = await get(target, bridgeHeaders);
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), target);
  }
  for (let i = 0; i < 8; i++) assert.equal((await get('/?key=wrong', { 'x-real-ip': 'rate-test' })).status, 401);
  assert.equal((await get('/?key=original-key', { 'x-real-ip': 'rate-test' })).status, 429);
  // Rotation is read per request and does not require touching either application's files.
  config.key = 'changed-key'; await fs.writeFile(file, JSON.stringify(config));
  assert.equal((await get('/?key=original-key')).status, 401);
  assert.equal((await get('/?key=changed-key')).status, 303);
  await stop(chat.server);
  assert.equal((await get('/lab/', bridgeHeaders)).status, 401);
  const withoutChat = await get('/?key=changed-key');
  assert.equal(withoutChat.status, 303); assert.equal(withoutChat.headers.get('location'), '/lab/');
  assert.equal(withoutChat.headers.getSetCookie().length, 1);
  await stop(editor.server);
  assert.equal((await get('/?key=changed-key')).status, 503);
  assert.equal((await get('/anything?key=changed-key')).status, 404);
  assert.ok(!/original-key|changed-key|chat-key|editor-key|native/.test(logs));
  console.log('PASS site entry: private-key login, two native cookies, session reuse, rate limits, key reload, independent login, editor session bridge with live chat validation, forged/revoked/missing cookie rejection, no API/write replay, no open redirects, fail-closed validator, no secret logs; no production data or models');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  for (const server of servers) if (server.listening) await stop(server);
  await fs.rm(temp, { recursive: true, force: true });
}
