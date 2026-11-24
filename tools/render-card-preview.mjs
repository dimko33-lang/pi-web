// Render the public card only; never capture a desktop or an authenticated page.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../docs/social-preview.png', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(new URL('../docs/index.html', import.meta.url).href);
  await page.addStyleTag({ content: `
    main { width:100%; max-width:none; height:100vh; padding:0 80px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center }
    main > :not(h1):not(.lead):not(.install) { display:none }
    h1 { margin:0 0 12px; font-size:112px; font-weight:600 }
    .lead { margin:0; max-width:none; font-size:38px; line-height:1.35 }
    .install { width:100%; margin:54px 0 0; padding:20px 22px; background-color:#171a1e }
    .install code { font-size:21px; white-space:nowrap }
    .install button { font-size:20px; padding:12px 20px }
  ` });
  await page.screenshot({ path: output });
} finally {
  await browser.close();
}
