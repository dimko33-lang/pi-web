import { chromium } from 'playwright-core';

export type CaptureTarget = 'chat';

/** Fresh, read-only browser: never the user's tab, camera or desktop. */
export async function captureBrowser({ origin, target, cookie, signal }: {
  origin: string; target: CaptureTarget; cookie?: string; signal: AbortSignal;
}): Promise<Buffer> {
  signal.throwIfAborted();
  const captureOrigin = new URL(origin);
  // Chromium blocks SIP port 5060, also used by our loopback app server.
  const allowLocal5060 = captureOrigin.protocol === 'http:' &&
    captureOrigin.hostname === '127.0.0.1' && captureOrigin.port === '5060';
  const browser = await chromium.launch({
    headless: true,
    ...(allowLocal5060 ? { args: ['--explicitly-allowed-ports=5060'] } : {}),
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });
  const abort = () => { void browser.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    if (cookie) await context.addCookies([{ name: 'cl_sid', value: cookie, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    // Block all writes, external navigation and collaboration side effects.
    const readApis = new Set(['/api/chat/history', '/api/chat/models', '/api/chat/usage', '/api/chat/status', '/api/chat/thinking']);
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || request.method() !== 'GET' ||
        (url.pathname.startsWith('/api/') && !readApis.has(url.pathname) &&
          !/^\/api\/chat\/images\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(url.pathname))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const path = '/';
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/chat/history' && response.ok());
    // Attach a handler immediately if navigation fails before the API responds.
    loaded.catch(() => {});
    const navigation = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!navigation?.ok()) throw new Error('Workspace page could not be opened');
    const response = await loaded;
    await response.finished();
    const payload = await response.json();
    await page.evaluate(() => document.fonts.ready);
      await page.locator('#chatInput').waitFor({ state: 'visible' });
      const lastAt = payload.messages?.at(-1)?.at;
      if (lastAt) await page.waitForFunction(at => Array.from(document.querySelectorAll('#chatMsgs .cm')).some(node => Number(node.getAttribute('data-at')) === at), lastAt);
      await page.evaluate(() => { const feed = document.getElementById('chatMsgs'); if (feed) feed.scrollTop = feed.scrollHeight; });
    // Allow response callbacks, layout and the existing UI animations to settle.
    await page.waitForTimeout(350);
    if (target === 'chat') await page.locator('.chat-tool-images img').evaluateAll(images => Promise.all(images.filter(image => {
      const bounds = image.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < innerHeight;
    }).map(image => image.decode().catch(() => {}))));
    signal.throwIfAborted();
    const image = await page.locator('#drawerChat').screenshot({ type: 'png', animations: 'disabled', timeout: 12000 });
    signal.throwIfAborted();
    return image;
  } finally {
    signal.removeEventListener('abort', abort);
    await browser.close();
  }
}
