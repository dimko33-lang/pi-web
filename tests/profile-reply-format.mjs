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
  for(const name of ['Text','Voice'])await section.locator('label.toggle').filter({hasText:new RegExp('^'+name+'$')}).click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/alpha')&&r.request().method()==='POST');await section.getByRole('button',{name:'Save',exact:true}).click();assert.equal((await saved).status(),200);
  const profiles=JSON.parse(readFileSync(path.join(dir,'conversation-profiles.json'))).profiles;
  assert.equal(profiles.alpha.textOutput,true);assert.equal(profiles.alpha.voiceOutput,true);assert.equal(profiles.beta,undefined);
  await page.reload();await section.getByText(/Match the incoming message/).waitFor();
  for(const name of ['Text','Voice'])assert.ok(await section.getByRole('checkbox',{name,exact:true}).isChecked());
  console.log('Mobile Text + Voice -> Save -> isolated profile on disk -> reload verified.');
} finally {await browser?.close();server.close();rmSync(dir,{recursive:true,force:true});}
