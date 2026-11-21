// Run against a disposable, freshly initialized launcher instance, never a production panel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const {PORT, PI_WEB_TICKET_FILE, PI_WEB_INSTANCE} = process.env;
assert.equal(PI_WEB_INSTANCE, 'starter-auth-test');
const key = crypto.randomBytes(24).toString('hex');
const request = (path, options = {}) => fetch(`http://127.0.0.1:${PORT}${path}`, {
  ...options, headers: {'X-Forwarded-Proto': 'https', ...options.headers}
});
const redeem = (key) => request('/open', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key}) });
const ticket = until => fs.writeFileSync(PI_WEB_TICKET_FILE, JSON.stringify({key, until}), {mode: 0o600});
const panel = await request('/profiles');
assert.equal(panel.status, 401);
assert.equal(panel.headers.get('x-pi-web-instance'), PI_WEB_INSTANCE);
assert.equal((await request('/open')).status, 200);
ticket(Date.now() - 1); assert.equal((await redeem(key)).status, 401);
ticket(Date.now() + 60000); assert.equal((await redeem('f'.repeat(48))).status, 401);
const success = await redeem(key); assert.equal(success.status, 204);
const cookie = success.headers.get('set-cookie'); assert.match(cookie, /Secure/);
assert.equal((await redeem(key)).status, 401);
assert.equal((await request('/profiles', {headers: {Cookie: cookie.split(';')[0]}})).status, 200);
console.log('Private-link session and replay checks passed.');
