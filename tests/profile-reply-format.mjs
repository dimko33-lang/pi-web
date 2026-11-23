// Isolated router + real mobile browser; no production profiles or Telegram credentials.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {chromium} from 'playwright-core';
import {createConversationProfiles} from '../server/conversation-profiles.ts';
const dir=mkdtempSync(path.join(tmpdir(),'profile-format-'));
process.env.PI_WEB_CONVERSATION_PROFILES=JSON.stringify(['alpha','beta'].map((id,i)=>({id,label:id,chatId:-1-i,tailKey:''})));
const app=express();app.use(express.json());app.use('/api/conversation-profiles',createConversationProfiles({directory:dir,basePrompt:()=>'',piReference:async()=>'',models:()=>['fixture'],thinking:async()=>({level:'off',levels:['off']}),defaults:()=>({model:'fixture',thinking:'off',replyMode:'mention_reply',systemPrompt:false,character:'',customPrompt:'',tail:'',tailOn:false,memory:false,memoryLimit:0,backgroundLimit:0,memoryEpoch:'test',memoryResetAt:0})}));
app.get('/api/chat/models',(_,res)=>res.json({models:[{id:'fixture'}]}));app.use(express.static('public'));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});const page=await browser.newPage({viewport:{width:390,height:800}});
  await page.goto(`http://127.0.0.1:${server.address().port}/conversation-profiles.html?chat=alpha`);
  const section=page.locator('[data-profile=alpha]');
  const switches=section.getByRole('group',{name:'Reply format'});
  await switches.waitFor();assert.equal(await section.locator('[data-format-hint]').count(),0);
  for(const width of [320,390,1000]) {
    await page.setViewportSize({width,height:800});
    const boxes=await Promise.all([section.getByRole('button',{name:'Old Chat'}),...['Text','Voice'].map(n=>switches.getByText(n,{exact:true}))].map(el=>el.boundingBox()));
    assert.ok(boxes.every((b,i)=>b&&b.x+b.width<=width&&(!i||b.x>boxes[i-1].x+boxes[i-1].width)&&Math.abs(b.y+b.height/2-boxes[0].y-boxes[0].height/2)<2));
  }
  for(const theme of ['light','dark']) {
    await page.evaluate(t=>document.documentElement.dataset.readerTheme=t,theme);
    const label=switches.getByText('Text',{exact:true});const color=()=>label.evaluate(el=>getComputedStyle(el).color);
    const off=await color();await label.click();const on=await color();await label.click();
    assert.equal(off,theme==='light'?'rgb(164, 161, 155)':'rgb(85, 83, 79)');assert.notEqual(on,off);
    const nav=page.locator('#profile-tabs'),a=nav.getByText('alpha',{exact:true}),b=nav.getByText('beta',{exact:true});
    const tabStyle=el=>el.evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).textDecorationLine]);
    assert.deepEqual(await tabStyle(a),[on,'underline']);assert.deepEqual(await tabStyle(b),[off,'none']);
    await b.click();assert.deepEqual(await tabStyle(b),[on,'underline']);assert.deepEqual(await tabStyle(a),[off,'none']);await a.click();
    assert.equal(await label.evaluate(el=>getComputedStyle(el,'::before').width),'1px');
  }
  for(const name of ['Text','Voice'])await section.locator('label.toggle').filter({hasText:new RegExp('^'+name+'$')}).click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/alpha')&&r.request().method()==='POST');await section.getByRole('button',{name:'Save',exact:true}).click();assert.equal((await saved).status(),200);
  const profiles=JSON.parse(readFileSync(path.join(dir,'conversation-profiles.json'))).profiles;
  assert.equal(profiles.alpha.textOutput,true);assert.equal(profiles.alpha.voiceOutput,true);assert.equal(profiles.beta,undefined);
  await page.reload();await switches.waitFor();
  for(const name of ['Text','Voice'])assert.ok(await section.getByRole('checkbox',{name,exact:true}).isChecked());
  console.log('Mobile Text + Voice -> Save -> isolated profile on disk -> reload verified.');
} finally {await browser?.close();server.close();rmSync(dir,{recursive:true,force:true});}
