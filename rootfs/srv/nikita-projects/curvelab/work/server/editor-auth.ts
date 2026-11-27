import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE = 'curvelab_editor_session';
const LIFETIME = 30 * 24 * 60 * 60 * 1000;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest();

/** Independent editor access: no Pi credentials, panel cookies or shared session files. */
export function editorAuth(base: string) {
  const password = process.env.EDITOR_PASSWORD || '';
  const localDevelopment = process.env.EDITOR_ALLOW_UNAUTHENTICATED === '1';
  if (!password && !localDevelopment) throw new Error('Set EDITOR_PASSWORD or explicitly enable local development');
  const sign = (issued: string) => crypto.createHmac('sha256', password).update(`editor:${issued}`).digest('hex');
  function authenticated(req: Request) {
    if (!password) return localDevelopment;
    const cookies = String(req.headers.cookie || '').split(';').map(value => value.trim());
    const token = cookies.find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
    const [issued, signature, extra] = token.split('.');
    if (extra || !/^\d+$/.test(issued || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
    const age = Date.now() - Number(issued);
    return age >= 0 && age < LIFETIME && crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(issued), 'hex'));
  }
  function guard(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.path === '/' && req.query.key !== undefined) {
      if (typeof req.query.key !== 'string' || !password || !crypto.timingSafeEqual(digest(req.query.key), digest(password))) {
        return res.status(401).type('text').send('Invalid editor access link');
      }
      const issued = String(Date.now());
      res.cookie(COOKIE, issued + '.' + sign(issued), {
        path: base + '/', httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: LIFETIME,
      });
      const url = new URL(req.originalUrl, 'http://editor.local');
      url.searchParams.delete('key');
      return res.redirect(303, url.pathname + url.search);
    }
    const publicRead = ['GET', 'HEAD'].includes(req.method) && (
      ['/', '/skeleton', '/skeleton/', '/loopform', '/loopform/', '/presence.js', '/api/watch', '/api/scene', '/api/presence', '/api/presence/watch', '/api/presence/leader'].includes(req.path) || req.path.startsWith('/editor/')
    );
    res.locals.editorOwner = authenticated(req);
    if (process.env.EDITOR_PUBLIC_VIEW === '1' && publicRead) return next();
    if (!res.locals.editorOwner) return res.status(401).type('text').send('Open the private editor access link first.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  }
  return guard;
}
