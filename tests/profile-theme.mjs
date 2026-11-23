// Run against a started panel. Use an isolated browser context; never change a profile.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const url=new URL('/profiles',process.argv[2] || 'http://127.0.0.1:5070');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
try {
  for(const width of [390,1000]) {
    const ctx=await browser.newContext({viewport:{width,height:800},colorScheme:'dark',storageState:process.env.TEST_BROWSER_STATE});
    const page=await ctx.newPage();
    const check=async (background,label)=>{
      const button=page.locator('header button.reader-theme-icon'); await button.waitFor();
      assert.equal(await button.count(),1); assert.equal(await button.textContent(),label);
      assert.deepEqual(await page.evaluate(()=>[document.documentElement,document.body,document.querySelector('header')].map(e=>getComputedStyle(e).backgroundColor)),Array(3).fill(background));
      const box=await button.boundingBox();assert.ok(box && box.x>width-65 && box.x+box.width<=width && box.y<=10);
    };
    try {
      assert.equal((await page.goto(url.href)).status(),200);
      await check('rgb(20, 20, 20)','☼');
      await page.getByRole('button',{name:'Switch to light theme'}).click();
      await check('rgb(250, 249, 246)','☾');
      await page.reload();await check('rgb(250, 249, 246)','☾');
      await page.getByRole('button',{name:'Switch to dark theme'}).click();
      await check('rgb(20, 20, 20)','☼');
    } finally {await ctx.close();}
  }
  console.log('Profiles: graphite/warm light, clickable top-right icon and reload persistence verified at 390 and 1000 px.');
} finally {await browser.close();}
