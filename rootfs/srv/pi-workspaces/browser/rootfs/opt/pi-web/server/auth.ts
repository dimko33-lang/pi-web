import './legacy-compat.ts';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* AUTH CONFIGURATION: password environment, browser sessions and request checks.
   No configured credentials means open access. Hash-only configuration needs
   separate review: PASSWORD_HASH initialization currently depends on PASSWORD. */
const PASSWORD = process.env.PI_WEB_PASSWORD || '';
const PASSWORD_HASH = PASSWORD
  ? (process.env.PI_WEB_PASSWORD_HASH || bcrypt.hashSync(PASSWORD, 10))
  : '';

// Browser sessions expire after seven days.
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/* SESSION STORAGE: persist browser sessions across process restarts. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');

function loadSessions(): Map<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8'));
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, exp]) => Number(exp) > now) as [string, number][]);
  } catch {
    return new Map();
  }
}

const sessions = loadSessions();

/* SESSION INVALIDATION: a credential fingerprint change clears sessions at startup. */
const PASS_PRINT = crypto.createHash('sha256').update(PASSWORD || process.env.PI_WEB_PASSWORD_HASH || '').digest('hex').slice(0, 16);

/* Compare the configured credentials with the persisted fingerprint. */
(function dropStaleSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESS_FILE, "utf8"));
    const savedPrint = raw && typeof raw.__print === "string" ? raw.__print : "";
    /* Missing legacy fingerprints also invalidate existing sessions. */
    if (savedPrint !== PASS_PRINT) {
      sessions.clear();
      fs.writeFileSync(SESS_FILE, JSON.stringify({ __print: PASS_PRINT }));
      console.log("[auth] credentials changed; all sessions invalidated");
    }
  } catch { /* No readable session file to invalidate. */ }
})();

function saveSessions() {
  try {
    fs.mkdirSync(path.dirname(SESS_FILE), { recursive: true });
    fs.writeFileSync(SESS_FILE, JSON.stringify({ __print: PASS_PRINT, ...Object.fromEntries(sessions) }));
  } catch { /* Session persistence is best-effort. */ }
}

/* LOGIN ATTEMPTS: per-IP failure counter and temporary blocking. */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 1000 * 60 * 10;

function ipOf(req) {
  return (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

export function checkRateLimit(req) {
  const ip = ipOf(req);
  const rec = attempts.get(ip);
  if (!rec) return { ok: true };
  if (rec.blockedUntil && rec.blockedUntil > Date.now()) {
    return { ok: false, until: rec.blockedUntil };
  }
  return { ok: true };
}

function noteFailure(req) {
  const ip = ipOf(req);
  const rec = attempts.get(ip) || { count: 0, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.blockedUntil = Date.now() + BLOCK_MS;
    rec.count = 0;
  }
  attempts.set(ip, rec);
}

function clearFailures(req) {
  attempts.delete(ipOf(req));
}

export async function verifyPassword(req, password) {
  if (!PASSWORD && !process.env.PI_WEB_PASSWORD_HASH) return true;  // No configured credentials: allow access.
  if (typeof password !== 'string' || !password) return false;
  const ok = await bcrypt.compare(password, PASSWORD_HASH);
  if (!ok) noteFailure(req);
  else clearFailures(req);
  return ok;
}

export function createSession(res) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
  saveSessions();
  /* COOKIE POLICY: HTTPS uses Secure + SameSite=None for embedded access.
     Local HTTP uses SameSite=Lax without Secure so browsers retain the cookie. */
  const secure = !!(res.req && (res.req.secure || res.req.headers['x-forwarded-proto'] === 'https'));
  res.cookie('cl_sid', sid, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  return sid;
}

/* AUTH CHECK: validate cl_sid when credentials are configured. */
export function isAuthenticated(req) {
  if (!PASSWORD && !process.env.PI_WEB_PASSWORD_HASH) return true;  // No configured credentials: allow access.
  const sid = req?.cookies?.cl_sid;
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(sid); saveSessions(); return false; }  return true;
}

export function destroySession(req, res) {
  const sid = req.cookies?.cl_sid;
  if (sid) { sessions.delete(sid); saveSessions(); }
  res.clearCookie('cl_sid', { path: '/' });
}

/* AUTH MIDDLEWARE: currently a pass-through, NOT an authorization boundary.
   Inspect explicit isAuthenticated checks when assessing route access. */
export function requireAuth(_req, _res, next) {
  return next();
}
