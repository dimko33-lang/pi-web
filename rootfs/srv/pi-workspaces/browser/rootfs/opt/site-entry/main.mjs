import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const configFile = process.env.SITE_ENTRY_CONFIG || '/etc/site-entry.json';
const navigation = fs.readFileSync(new URL('./navigation.js', import.meta.url));
const digest = value => crypto.createHash('sha256').update(value).digest();
const attempts = new Map();
const MAX_FAILURES = 8;
const BLOCK_MS = 10 * 60 * 1000;

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config.key || !Array.isArray(config.apps) || !config.apps.length) throw Error('Invalid entry configuration');
  for (const app of config.apps) {
    const url = new URL(app.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !app.key || !/^\w+$/.test(app.cookie)) throw Error('Invalid local login target');
  }
  return config;
}

async function hasNativeSession(app, incomingCookie) {
  if (!app?.check || !incomingCookie.split(';').some(value => value.trim().startsWith(app.cookie + '='))) return false;
  const check = new URL(app.check, app.url);
  if (check.origin !== new URL(app.url).origin) throw Error('Invalid session check');
  try {
    const response = await fetch(check, {
      redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'x-forwarded-proto': 'https', cookie: incomingCookie },
    });
    await response.arrayBuffer();
    return response.ok;
  } catch { return false; } // An unavailable validator never grants access.
}

async function login(app, incomingCookie) {
  // Reuse a valid native session instead of creating a new one on every link click.
  // The read-only resource is fixed in deployment config, never supplied by a visitor.
  const options = { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'x-forwarded-proto': 'https' } };
  const hasCookie = incomingCookie.split(';').some(value => value.trim().startsWith(app.cookie + '='));
  if (hasCookie && app.check) {
    const check = new URL(app.check, app.url);
    if (check.origin !== new URL(app.url).origin) throw Error('Invalid session check');
    try {
      const response = await fetch(check, { ...options, headers: { ...options.headers, cookie: incomingCookie } });
      await response.arrayBuffer();
      if (response.ok) return { app, cookies: [] };
    } catch { /* Try the normal private-link login below. */ }
  }
  const url = new URL(app.url);
  url.searchParams.set('key', app.key);
  const response = await fetch(url, options);
  await response.arrayBuffer();
  const cookies = response.headers.getSetCookie().filter(cookie => cookie.startsWith(app.cookie + '='));
  if (![302, 303].includes(response.status) || cookies.length !== 1 || !/;\s*HttpOnly(?:;|$)/i.test(cookies[0]) || !/;\s*Secure(?:;|$)/i.test(cookies[0])) throw Error('Application login unavailable');
  return { app, cookies };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://site.local');
    if (url.pathname === '/_site/navigation.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(navigation);
    }
    if (req.headers['x-site-editor-session'] !== '1' &&
        (req.method !== 'GET' || !['/', '/lab/'].includes(url.pathname))) { res.writeHead(404); return res.end('Not found'); }
    const config = loadConfig();
    // Nginx invokes this only after the independent editor rejected a request.
    // Verify a live panel session before issuing the editor's native cookie.
    // Never bootstrap API calls, writes, or an explicitly supplied access key.
    if (req.headers['x-site-editor-session'] === '1') {
      const documents = ['/lab/', '/lab/skeleton', '/lab/skeleton/', '/lab/loopform', '/lab/loopform/'];
      if (req.method !== 'GET' || !documents.includes(url.pathname) || url.searchParams.has('key')) {
        res.writeHead(401); return res.end('Authentication required.');
      }
      const panel = config.apps.find(app => app.path === '/');
      const editor = config.apps.find(app => app.path === '/lab/');
      if (!panel || !editor) throw Error('Missing session bridge target');
      if (!await hasNativeSession(panel, req.headers.cookie || '')) {
        res.writeHead(401); return res.end('Sign in to the chat first, then reopen CurveLab.');
      }
      const result = await login(editor, req.headers.cookie || '');
      if (result.cookies.length) res.setHeader('Set-Cookie', result.cookies);
      res.writeHead(303, { Location: url.pathname + url.search });
      return res.end();
    }
    const supplied = url.searchParams.getAll('key');
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
    const now = Date.now();
    for (const [address, item] of attempts) if (item.until < now) attempts.delete(address);
    const previous = attempts.get(ip);
    if (previous?.count >= MAX_FAILURES) { res.writeHead(429); return res.end('Too many login attempts. Try again later.'); }
    if (supplied.length !== 1 || !crypto.timingSafeEqual(digest(supplied[0]), digest(config.key))) {
      attempts.set(ip, { count: (previous?.count || 0) + 1, until: now + BLOCK_MS });
      res.writeHead(401); return res.end('Invalid access link.');
    }
    attempts.delete(ip);
    const results = await Promise.allSettled(config.apps.map(app => login(app, req.headers.cookie || '')));
    const successful = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    const cookies = successful.flatMap(result => result.cookies);
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    const destination = url.pathname;
    // A stopped app must not prevent logging into the other app.
    const selected = successful.find(result => result.app.path === destination) || successful[0];
    if (!selected) { res.writeHead(503); return res.end('Applications are temporarily unavailable.'); }
    res.writeHead(303, { Location: selected.app.path });
    res.end();
  } catch {
    // Never log request URLs, private keys, native cookies or fetch error causes.
    res.writeHead(503); res.end('Site entry is temporarily unavailable.');
  }
});
server.maxHeadersCount = 64;
server.requestTimeout = 10000;
server.listen(Number(process.env.PORT || 5090), '127.0.0.1', () => console.log('Site entry listening on loopback'));
