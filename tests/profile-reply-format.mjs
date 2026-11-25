// Isolated router + real mobile browser; no production profiles or Telegram credentials.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {chromium,webkit} from 'playwright-core';
import {createConversationProfiles} from '../server/conversation-profiles.ts';
const dir=mkdtempSync(path.join(tmpdir(),'profile-format-'));
process.env.PI_WEB_CONVERSATION_PROFILES=JSON.stringify([{id:'alpha',label:'alpha',chatId:-1},{id:'beta',label:'beta',chatId:-2},{id:'dm',label:'dm',chatId:7,kind:'private'},{id:'guest_dm',label:'Other DMs',chatId:null,kind:'private_default'}]);
const app=express();app.use(express.json());app.use('/api/conversation-profiles',createConversationProfiles({directory:dir,basePrompt:()=>'',piReference:async()=>'',models:()=>['fixture','alternate'],thinking:async()=>({level:'off',levels:['off']}),defaults:()=>({model:'fixture',thinking:'off',replyMode:'mention_reply',systemPrompt:false,character:'',customPrompt:'',tail:'',tailOn:false,memory:false,memoryLimit:150,backgroundLimit:0,memoryEpoch:'test',memoryResetAt:0})}));
app.get('/api/chat/models',(_,res)=>res.json({models:[{id:'fixture'},{id:'alternate'}]}));app.use(express.static('public'));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
try {
  browser=process.argv.includes('--webkit')?await webkit.launch():await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  const page=await browser.newPage({viewport:{width:390,height:800}});
  await page.goto(`http://127.0.0.1:${server.address().port}/conversation-profiles.html?chat=alpha`);
  const section=page.locator('[data-profile=alpha]');
  const switches=section.getByRole('group',{name:'Reply format'});
  await switches.waitFor();assert.equal(await section.getByRole('combobox',{name:'Voice preset'}).count(),0);assert.equal(await section.locator('[data-format-hint]').count(),0);
  const marker=section.locator('.draft-status');
  const nextHeadingTop=()=>section.locator('[name=piOn]').evaluate(input=>input.closest('.field-heading').getBoundingClientRect().top);
  const save=async()=>{
    const response=page.waitForResponse(r=>r.url().endsWith('/alpha')&&r.request().method()==='POST');
    await section.getByRole('button',{name:'Save',exact:true}).click();return (await response).status();
  };
  for(const width of [320,390,1000]) {
    await page.setViewportSize({width,height:800});
    const boxes=await Promise.all([section.getByRole('button',{name:'Old Chat'}),...['Text','Voice'].map(n=>switches.getByText(n,{exact:true}))].map(el=>el.boundingBox()));
    assert.ok(boxes.every((b,i)=>b&&b.x+b.width<=width&&(!i||b.x>boxes[i-1].x+boxes[i-1].width)&&Math.abs(b.y+b.height/2-boxes[0].y-boxes[0].height/2)<2),`Action row at ${width}px: ${JSON.stringify(boxes)}`);
    const top=await nextHeadingTop(), voice=boxes.at(-1);
    assert.equal(await marker.textContent(),'');
    const mem=section.getByRole('group',{name:'Memory windows'}), person=mem.getByRole('spinbutton',{name:'Earlier participant messages'});
    const positions=await mem.locator('.number-slot').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.left,r.right,r.top]}));
    assert.ok(positions.every(([l,r,t],i)=>l>=0 && r<=width && (!i || l>=positions[i-1][1] && Math.abs(t-positions[0][2])<=1)),`Memory windows at ${width}px: ${JSON.stringify(positions)}`);
    assert.deepEqual(await mem.locator('.number-slot label').allTextContents().then(x=>x.map(t=>t.trim())),['Person','Group','BG']);
    assert.equal(await section.getByRole('checkbox',{name:'Memory',exact:true}).count(),0);
    assert.equal(await mem.getByRole('slider').count(),0);
    const toggle=mem.getByRole('checkbox',{name:'Person',exact:true}), label=mem.getByText('Person',{exact:true});
    assert.equal(await toggle.isChecked(),false);
    await label.click();assert.equal(await toggle.isChecked(),true);
    assert.equal(await person.inputValue(),width===320?'1':'100');
    await person.fill('100');await label.click();assert.equal(await toggle.isChecked(),false);assert.equal(await person.inputValue(),'100');
    assert.equal(await mem.getByRole('checkbox',{name:'BG',exact:true}).isChecked(),false);
    await section.getByRole('spinbutton',{name:'Earlier dialogue messages'}).fill(String(width/10));
    assert.equal(await marker.textContent(),'Unsaved changes');
    const m=await marker.boundingBox();assert.ok(m && m.x>voice.x+voice.width && m.x+m.width<=width && Math.abs(m.y+m.height/2-voice.y-voice.height/2)<2);
    assert.equal(await nextHeadingTop(),top,'Editing must not move the content below the toolbar');
    assert.equal(await save(),200);await section.locator('.draft-status:empty').waitFor({state:'attached'});
    assert.equal(await nextHeadingTop(),top,'Saving must not move the content below the toolbar');
  }
  for(const theme of ['light','dark']) {
    await page.evaluate(t=>document.documentElement.dataset.readerTheme=t,theme);
    const label=switches.getByText('Text',{exact:true});const color=()=>label.evaluate(el=>getComputedStyle(el).color);
    const off=await color();await label.click();const on=await color();await label.click();
    assert.equal(await marker.evaluate(el=>getComputedStyle(el).color),theme==='light'?'rgb(180, 35, 43)':'rgb(255, 107, 107)');
    assert.equal(off,theme==='light'?'rgb(164, 161, 155)':'rgb(85, 83, 79)');assert.notEqual(on,off);
    const person=section.locator('[name=personLimit]'),personLabel=section.getByText('Person',{exact:true});
    const pairColors=()=>Promise.all([personLabel,person].map(el=>el.evaluate(n=>getComputedStyle(n).color)));
    assert.deepEqual(await pairColors(),[off,off]);await personLabel.click();assert.deepEqual(await pairColors(),[on,on]);
    await personLabel.click();assert.equal(await person.inputValue(),'100');assert.deepEqual(await pairColors(),[off,off]);
    const nav=page.locator('#profile-tabs'),a=nav.getByText('alpha',{exact:true}),b=nav.getByText('beta',{exact:true});
    const tabStyle=el=>el.evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).textDecorationLine]);
    const boxes=()=>nav.locator('a').evaluateAll(links=>links.map(link=>{const {x,y,width,height}=link.getBoundingClientRect();return [x,y,width,height]}));
    await page.setViewportSize({width:390,height:800});const before=await boxes();
    assert.deepEqual(await tabStyle(a),[on,'none']);assert.deepEqual(await tabStyle(b),[off,'none']);
    await b.click();assert.deepEqual(await tabStyle(b),[on,'none']);assert.deepEqual(await tabStyle(a),[off,'none']);assert.deepEqual(await boxes(),before);
    assert.equal(await page.locator('[data-profile=beta] .draft-status').textContent(),'');
    await a.click();assert.equal(await marker.textContent(),'Unsaved changes');
    assert.equal(await label.evaluate(el=>getComputedStyle(el,'::before').width),'1px');
  }
  for(const name of ['Text','Voice'])await section.locator('label.toggle').filter({hasText:new RegExp('^'+name+'$')}).click();
  await page.route('**/api/conversation-profiles/alpha',route=>route.fulfill({status:503,json:{error:'Test save unavailable'}}),{times:1});
  assert.equal(await save(),503);await section.locator('.feedback.error').waitFor();assert.equal(await marker.textContent(),'Unsaved changes');
  assert.equal(await save(),200);await section.locator('.draft-status:empty').waitFor({state:'attached'});
  const profiles=JSON.parse(readFileSync(path.join(dir,'conversation-profiles.json'))).profiles;
  assert.equal(profiles.alpha.textOutput,true);assert.equal(profiles.alpha.voiceOutput,true);assert.equal(profiles.beta,undefined);
  await page.reload();await switches.waitFor();
  for(const name of ['Text','Voice'])assert.ok(await section.getByRole('checkbox',{name,exact:true}).isChecked());
  assert.equal(await section.locator('[name=personLimit]').inputValue(),'100');
  const personSwitch=section.getByRole('checkbox',{name:'Person',exact:true});assert.equal(await personSwitch.isChecked(),false);
  assert.equal(await section.getByRole('checkbox',{name:'Group',exact:true}).isChecked(),true);
  assert.equal(await section.getByRole('checkbox',{name:'BG',exact:true}).isChecked(),false);
  await personSwitch.focus();await page.keyboard.press('Space');assert.equal(await personSwitch.isChecked(),true);
  assert.equal(await section.locator('[name=personLimit]').inputValue(),'100');
  await section.locator('[name=backgroundLimit]').fill('9');assert.equal(await section.locator('[name=backgroundOn]').isChecked(),true);
  await section.locator('[name=backgroundLimit]').fill('0');assert.equal(await section.locator('[name=backgroundOn]').isChecked(),false);
  await page.locator('#profile-tabs').getByText('dm',{exact:true}).click();
  const dm=page.locator('[data-profile=dm]');assert.equal(await dm.locator('.number-slot:visible').count(),1);
  assert.equal(await dm.locator('[name=personLimit]').isDisabled(),true);
  const dialogue=dm.getByRole('checkbox',{name:'Dialogue',exact:true});assert.equal(await dialogue.isChecked(),false);
  await dm.getByText('Dialogue',{exact:true}).click();assert.equal(await dialogue.isChecked(),true);
  assert.equal(await dm.locator('[name=memoryLimit]').inputValue(),'150');
  const speaker=dm.getByRole('combobox',{name:'Voice preset',exact:true}), model=dm.getByRole('combobox',{name:'Model',exact:true});
  const list=name=>dm.getByRole('listbox',{name:name+' options',exact:true});
  const voiceList=list('Voice preset'), modelList=list('Model'), value=dm.locator('select[name=voicePreset]');
  assert.equal(await speaker.textContent(),'Gacrux');assert.equal(await value.isHidden(),true);
  const ink=el=>el.evaluate(node=>{const s=getComputedStyle(node);return ['fontFamily','fontSize','fontWeight','lineHeight','textAlign','padding','color','backgroundColor','backgroundImage','borderWidth','borderRadius','boxShadow'].map(k=>s[k]);});
  const measure=async(trigger,menu,width)=>{
    await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    const t=await trigger.boundingBox(),m=await menu.boundingBox();
    assert.ok(m && Math.abs(m.x-t.x)<1 && Math.abs(m.y-t.y-t.height)<1 && m.x+m.width<=width+1,'Menu must drop directly below its label and fit the viewport');
    const styles=[await ink(trigger),await ink(menu),await ink(menu.locator('[aria-selected=true]')),await ink(menu.locator('[aria-selected=false]').first())];
    await trigger.press('Escape');assert.equal(await menu.isVisible(),false);return styles;
  };
  for(const width of [320,390,1000]){
    await page.setViewportSize({width,height:800});
    for(const theme of ['light','dark']){
      await page.evaluate(t=>document.documentElement.dataset.readerTheme=t,theme);
      assert.deepEqual(await measure(speaker,voiceList,width),await measure(model,modelList,width),`Same picker styles at ${width}px, ${theme}`);
    }
  }
  await speaker.click();assert.deepEqual(await voiceList.getByRole('option').allTextContents(),['Gacrux','Charon · Quiet elder']);
  await voiceList.getByRole('option',{name:'Charon · Quiet elder',exact:true}).click();
  assert.equal(await speaker.textContent(),'Charon · Quiet elder');assert.equal(await value.inputValue(),'charon-elder');
  assert.equal(await voiceList.isVisible(),false);assert.equal(await dm.locator('.draft-status').textContent(),'Unsaved changes');
  const dmSaved=page.waitForResponse(r=>r.url().endsWith('/dm')&&r.request().method()==='POST');await dm.getByRole('button',{name:'Save',exact:true}).click();assert.equal((await dmSaved).status(),200);
  const dmSettings=JSON.parse(readFileSync(path.join(dir,'conversation-profiles.json'))).profiles.dm;
  assert.equal(dmSettings.memory,true);assert.equal(dmSettings.voicePreset,'charon-elder');assert.equal(dmSettings.voiceOutput,false);
  await page.reload();await speaker.waitFor();await page.setViewportSize({width:320,height:800});
  assert.equal(await speaker.textContent(),'Charon · Quiet elder');assert.equal(await speaker.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await speaker.press('ArrowDown');await speaker.press('Home');await speaker.press('Escape');
  assert.equal(await value.inputValue(),'charon-elder');assert.equal(await dm.locator('.draft-status').textContent(),'');
  await speaker.press('ArrowDown');await speaker.press('Home');await speaker.press('Enter');assert.equal(await speaker.textContent(),'Gacrux');
  await speaker.click();await page.locator('#profile-tabs').getByText('Other DMs',{exact:true}).click();
  assert.equal(await page.locator('[data-profile=guest_dm]').getByRole('combobox',{name:'Voice preset'}).count(),0);
  await page.locator('#profile-tabs').getByText('dm',{exact:true}).click();assert.equal(await voiceList.isVisible(),false);
  assert.equal(await speaker.textContent(),'Gacrux');assert.equal(await dm.locator('.draft-status').textContent(),'Unsaved changes');
  assert.equal(JSON.parse(readFileSync(path.join(dir,'conversation-profiles.json'))).profiles.dm.voicePreset,'charon-elder');
  console.log('Memory windows, Save/reload and drafts verified; the private voice and model pickers share styles, dropdown geometry and keyboard behavior at 320/390/1000 px.');
} finally {await browser?.close();server.close();rmSync(dir,{recursive:true,force:true});}
