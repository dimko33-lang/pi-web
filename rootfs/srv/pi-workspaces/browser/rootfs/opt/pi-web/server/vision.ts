import crypto from 'node:crypto';
import { captureBrowser, type CaptureTarget } from './vision-browser.ts';

/** Chat capture is always available to authenticated tool-enabled turns.
 * Per-turn capabilities, authentication, concurrency and size limits still apply. */
export function createVision({ origin, capture = captureBrowser, now = Date.now }: {
  origin: string; capture?: typeof captureBrowser; now?: () => number;
}) {
  const turns = new Map<string, { cookie?: string; count: number; pending: boolean; controller: AbortController }>();
  function beginTurn(cookie?: string) {
    const token = crypto.randomBytes(32).toString('hex');
    turns.set(token, { cookie, count: 0, pending: false, controller: new AbortController() });
    return { token, endpoint: origin + '/api/vision/capture' };
  }
  function endTurn(token?: string) {
    if (!token) return;
    turns.get(token)?.controller.abort();
    turns.delete(token);
  }
  async function screenshot(token: string, target: CaptureTarget, authorized: (cookie?: string) => boolean) {
    const turn = turns.get(token);
    if (!turn || !authorized(turn.cookie)) throw new Error('Capture requires an authenticated active turn');
    if (target !== 'chat') throw new Error('Capture target must be chat');
    if (turn.pending || turn.count >= 8) throw new Error('Capture limit reached or another capture is running');
    turn.pending = true; turn.count++;
    const signal = AbortSignal.any([turn.controller.signal, AbortSignal.timeout(30000)]);
    try {
      const image = await capture({ origin, target, cookie: turn.cookie, signal });
      signal.throwIfAborted();
      if (!turns.has(token) || !authorized(turn.cookie)) throw new Error('Capture authorization expired');
      if (image.length > 8 * 1024 * 1024) throw new Error('Screenshot exceeds the image size limit');
      return { data: image.toString('base64'), mimeType: 'image/png', capturedAt: now(), target, source: 'agent-browser' };
    } finally { turn.pending = false; }
  }
  return { beginTurn, endTurn, screenshot };
}
