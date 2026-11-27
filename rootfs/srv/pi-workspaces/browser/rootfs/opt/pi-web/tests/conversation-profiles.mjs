import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const source = process.argv[2];
const temp = fs.mkdtempSync('/tmp/conversation-profiles-test-');
const tabsBorder = page => page.locator('#profile-tabs a:not([aria-current])').first().evaluate(element => getComputedStyle(element).borderTopColor);
let child, browser, log = '';
try {
  const app = path.join(temp, 'app'); fs.mkdirSync(app);
  for (const name of ['server', 'public', 'package.json', 'models.json']) fs.cpSync(path.join(source, name), path.join(app, name), { recursive: true });
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(app, 'node_modules'));
  for (const name of ['data', 'sessions', 'home']) fs.mkdirSync(path.join(app, name));
  const baseline = { character: 'GLOBAL_CHARACTER', customPrompt: 'GLOBAL_CUSTOM', memory: true, systemPrompt: true,
    memoryEpoch: 'global-epoch', memoryResetAt: 0, memoryLimit: 200, tailPiwep: 'GLOBAL_TAIL', lightconeReplies: true, debriReplies: true };
  fs.writeFileSync(path.join(app, 'data/settings.json'), JSON.stringify(baseline));
  const baseSource = path.join(temp, 'base-system.txt');
  fs.writeFileSync(baseSource, 'FIXTURE_BASE_SYSTEM');
  fs.writeFileSync(path.join(app, 'data/addressing.json'), JSON.stringify({ names: ['Nikita', 'Socrates'], chatModes: { '-@@LC_PEER@@': 'addressed' } }));
  const registry = [
    { id: 'piwep', label: 'Pi Web', chatId: -@@PROJECT_PEER@@, kind: 'group', tailKey: 'tailPiwep' },
    { id: 'curvelab', label: 'CurveLab', chatId: -@@LAB_PEER@@, kind: 'group', tailKey: '' },
    { id: 'lightcone', label: 'LightCone', chatId: -@@LC_PEER@@, kind: 'group', tailKey: 'tailLightcone', backgroundLimit: 200, enabledKey: 'lightconeReplies' },
    { id: 'debri', label: 'Debri', chatId: -@@DEBRI_CHANNEL@@, chatIds: [-@@DEBRI_CHANNEL@@, -@@DEBRI_PEER@@], kind: 'group', tailKey: 'tailDebri' },
    { id: 'owner_dm', label: 'My DM', chatId: 1, kind: 'private', tailKey: 'tailDirect' },
    { id: 'guest_dm', label: 'Other DMs', chatId: null, kind: 'private_default', tailKey: 'tailDirect' }
  ];
  fs.writeFileSync(path.join(app, 'data/model.txt'), 'openai/gpt-6-astra');
  fs.writeFileSync(path.join(app, 'data/chat-thinking.json'), JSON.stringify({ 'openai/gpt-6-astra': 'high' }));
  const runtime = path.join(temp, 'fake-runtime'); fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent' }));
  fs.symlinkSync('/opt/pi-web-runtime/node_modules/@earendil-works/pi-coding-agent/dist', path.join(runtime, 'dist'));
  fs.symlinkSync('/opt/pi-web-runtime/node_modules/@earendil-works/pi-ai', path.join(temp, 'pi-ai'));
  const bin = path.join(runtime, 'pi');
  fs.writeFileSync(bin, '#!/bin/sh\nexit 90\n', { mode: 0o755 });
  const listener = net.createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), HOME: path.join(app, 'home'), PI_CODING_AGENT_DIR: path.join(app, 'home/.pi/agent'),
    PI_WEB_ADMIN_ENABLED: '0', PI_WEB_PASSWORD: 'test-password', PI_WEB_PASSWORD_HASH: '', CURVELAB_PASSWORD: '', CURVELAB_PASSWORD_HASH: '',
    PI_WEB_AGENT_ROOT: app, PI_WEB_SESSIONS_DIR: path.join(app, 'sessions'), PI_WEB_PI_BIN: bin, PI_WEB_TOOL_ENVIRONMENT: '',
    PI_WEB_SHARED_SYSTEM_PROMPT: baseSource,
    PI_WEB_CONVERSATION_TITLE: 'Nikita', PI_WEB_CONVERSATION_PROFILES: JSON.stringify(registry) };
  child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
  const origin = `http://127.0.0.1:${port}`; let cookie = '';
  const post = (route, body, extra = {}) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, ...extra }, body: JSON.stringify(body) });
  const get = route => fetch(origin + route, { headers: { Cookie: cookie } });
  for (let i = 0; i < 100; i++) { try { if ((await get('/')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(child.exitCode, null, log);
  assert.equal((await get('/api/conversation-profiles')).status, 401);
  assert.equal((await get('/profiles')).status, 401);
  assert.equal((await post('/api/conversation-profiles/piwep', { action: 'restore', revision: 0 })).status, 401);
  const login = await fetch(origin + '/?key=test-password', { redirect: 'manual' }); assert.equal(login.status, 302);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const endpoint = '/api/conversation-profiles';
  let data = await (await get(endpoint)).json();
  assert.deepEqual(data.addressingNames, ['Nikita', 'Socrates']);
  assert.equal(data.revision, 0); assert.equal(data.profiles[0].independent, false);
  assert.equal(data.profiles.length, 6);
  assert.equal(data.profiles[2].settings.backgroundLimit, 200);
  assert.equal(data.profiles[2].settings.replyMode, 'addressed');
  assert.equal(data.profiles[4].settings.backgroundLimit, 0);
  assert.equal(data.profiles[5].settings.replyMode, 'all');
  assert.equal(fs.existsSync(path.join(app, 'data/conversation-profiles.json')), false);
  assert.equal(data.profiles[0].settings.memoryLimit, 100);
  assert.ok(data.profiles.every(item => item.settings.customOn === true));
  assert.ok(data.profiles.every(item => item.settings.baseOn === true && item.settings.toolsOn === true));
  assert.ok(data.profiles.every(item => item.settings.basePrompt === 'FIXTURE_BASE_SYSTEM'));
  const settings = Object.fromEntries(Object.entries(data.profiles[0].settings).filter(([key]) => !['memoryEpoch', 'memoryResetAt'].includes(key)));
  const metadata = await (await get(endpoint + '/thinking?model=' + encodeURIComponent(settings.model))).json();
  assert.ok(metadata.levels.includes(settings.thinking));
  let response = await post(endpoint + '/piwep', { action: 'save', revision: 0, settings: { ...settings, character: 'LOCAL_CHARACTER', tail: '{"style":"precise"}' } });
  assert.equal(response.status, 200, await response.clone().text()); data = await response.json();
  assert.equal(data.profiles[0].settings.memoryEpoch, 'global-epoch');
  assert.equal((fs.statSync(path.join(app, 'data/conversation-profiles.json')).mode & 0o777), 0o600);
  const storePath = path.join(app, 'data/conversation-profiles.json');
  const legacyStore = JSON.parse(fs.readFileSync(storePath));
  delete legacyStore.profiles.piwep.customOn;
  delete legacyStore.profiles.piwep.baseOn;
  delete legacyStore.profiles.piwep.toolsOn;
  delete legacyStore.profiles.piwep.basePrompt;
  fs.writeFileSync(storePath, JSON.stringify(legacyStore));
  const legacyBytes = fs.readFileSync(storePath);
  assert.equal((await (await get(endpoint)).json()).profiles[0].settings.customOn, true);
  assert.deepEqual(fs.readFileSync(storePath), legacyBytes);
  assert.equal((await post(endpoint + '/piwep', { action: 'save', revision: 0, settings })).status, 409);
  for (const bad of [{ memoryLimit: 501 }, { backgroundLimit: 501 }, { memoryLimit: -1 }, { backgroundLimit: 2.5 }, { character: 'x'.repeat(8001) }, { replyMode: 'context' }, { model: 'unknown/model' }, { thinking: 'impossible' }, { memory: 'false' }, { customOn: 'false' }, { customOn: null }, { customOn: 0 }, { customOn: undefined }, { baseOn: null }, { baseOn: 'false' }, { toolsOn: 0 }, { toolsOn: undefined }, { basePrompt: 'x'.repeat(30001) }, { basePrompt: null }, { memoryEpoch: 'client-owned' }]) {
    assert.equal((await post(endpoint + '/piwep', { action: 'save', revision: 1, settings: { ...settings, ...bad } })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await post(endpoint + '/other-chat', { action: 'reset', revision: 1 })).status, 404);
  assert.equal((await post(endpoint + '/piwep', { action: 'reset', revision: 1 }, { Origin: 'https://other.invalid' })).status, 403);
  response = await post(endpoint + '/piwep', { action: 'reset', revision: 1 }); data = await response.json();
  assert.equal(response.status, 200); assert.notEqual(data.profiles[0].settings.memoryEpoch, 'global-epoch');
  assert.ok(data.profiles[0].settings.memoryResetAt > 0);
  const epoch = data.profiles[0].settings.memoryEpoch;
  response = await post(endpoint + '/piwep', { action: 'save', revision: 2, settings: { ...settings, memory: false } }); data = await response.json();
  assert.equal(data.profiles[0].settings.memoryEpoch, epoch);
  const resetAt = data.profiles[0].settings.memoryResetAt;
  response = await post(endpoint + '/piwep', { action: 'save', revision: data.revision, settings: { ...settings, memory: true } }); data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.profiles[0].settings.memoryEpoch, epoch);
  assert.equal(data.profiles[0].settings.memoryResetAt, resetAt);
  const beforeRestore = data;
  assert.equal((await post(endpoint + '/piwep', { action: 'restore', revision: data.revision }, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await post(endpoint + '/other-chat', { action: 'restore', revision: data.revision })).status, 404);
  assert.equal((await post(endpoint + '/piwep', { action: 'restore', revision: data.revision - 1 })).status, 409);
  assert.equal((await post(endpoint + '/piwep', { action: 'unknown', revision: data.revision })).status, 400);
  response = await post(endpoint + '/piwep', { action: 'restore', revision: data.revision });
  assert.equal(response.status, 200); data = await response.json();
  assert.equal(data.revision, beforeRestore.revision + 1);
  assert.notEqual(data.profiles[0].settings.memoryEpoch, epoch);
  assert.equal(data.profiles[0].settings.memoryResetAt, 0);
  assert.deepEqual(data.profiles[0].settings, { ...beforeRestore.profiles[0].settings,
    memoryEpoch: data.profiles[0].settings.memoryEpoch, memoryResetAt: 0 });
  assert.deepEqual(data.profiles.slice(1), beforeRestore.profiles.slice(1));
  assert.equal((await post(endpoint + '/piwep', { action: 'reset', revision: beforeRestore.revision })).status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'data/settings.json'))), baseline);
  assert.equal(fs.readFileSync(path.join(app, 'data/model.txt'), 'utf8'), settings.model);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext();
  await context.addCookies([{ name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: origin }]);
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); assert.equal(await page.locator('.app-brand').getAttribute('href'), '/profiles');
  await page.waitForFunction(() => document.querySelector('#styleSwitch')?.getAttribute('aria-pressed') === 'false');
  await page.locator('#styleSwitch').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.locator('#styleSwitch').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  const brandBounds = await page.locator('.app-brand').boundingBox();
  await page.locator('.app-brand').click();
  await page.waitForFunction(() => document.querySelector('select[name="thinking"]')?.options.length > 0 && !document.querySelector('select[name="thinking"]').disabled);
  assert.equal(await page.locator('h1').textContent(), 'Nikita');
  const fullscreen = page.locator('#profile-fullscreen');
  assert.equal((await fullscreen.boundingBox()).height, 48);
  await fullscreen.click(); await page.waitForFunction(() => Boolean(document.fullscreenElement));
  assert.equal(await fullscreen.getAttribute('aria-pressed'), 'true');
  await fullscreen.click(); await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await page.locator('#reload').count(), 0);
  assert.equal(await page.locator('#back-to-chat').getAttribute('href'), '/');
  assert.equal(await page.locator('#profile-tabs a').count(), 6);
  const active = page.locator('section:not([hidden])');
  assert.equal(await active.getByRole('button', { name: 'New Chat', exact: true }).count(), 1);
  assert.equal(await active.getByRole('button', { name: 'Old Chat', exact: true }).count(), 1);
  assert.match(await active.locator('[data-memory-scope]').textContent(), /all retained messages/);
  assert.deepEqual(await page.locator('#back-to-chat').boundingBox(), brandBounds);
  assert.equal(await tabsBorder(page), 'rgba(0, 0, 0, 0)');
  const geometry = await active.locator('.profile-picker-trigger').evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { top: bounds.top, height: bounds.height, radius: style.borderRadius, border: style.borderTop, arrow: style.backgroundImage, appearance: style.appearance };
  }));
  assert.deepEqual(geometry[0], geometry[1]); assert.deepEqual(geometry[1], geometry[2]);
  assert.equal(geometry[0].height, 39);
  const trigger = name => active.locator(`.profile-picker-trigger[data-field="${name}"]`);
  const list = name => active.locator(`.profile-picker-list[data-field="${name}"]`);
  for (const name of ['model', 'thinking', 'replyMode']) {
    assert.equal(await active.locator(`select[name="${name}"]`).isHidden(), true);
    const button = trigger(name);
    await button.click();
    const field = await button.boundingBox(), popup = await list(name).boundingBox();
    assert.ok(popup.y >= field.y + field.height + 5, name + ' opens below');
    assert.equal(popup.width, field.width);
    await button.press('End'); await button.press('Escape');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    await button.click(); await list(name).locator('[aria-selected="true"]').click();
    assert.equal(await button.textContent(), await active.locator(`select[name="${name}"] option:checked`).textContent());
    await page.waitForFunction(() => document.querySelector('.profile-picker-trigger[data-field="thinking"]')?.disabled === false);
    await button.click(); await button.press('Tab');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
  }
  await trigger('model').click(); await trigger('replyMode').click();
  assert.equal(await trigger('model').getAttribute('aria-expanded'), 'false');
  await trigger('replyMode').press('Escape');
  const hint = active.locator('[data-reply-hint]');
  assert.equal(await active.locator('.profile-picker-field').nth(2).locator('[data-reply-hint]').count(), 1);
  assert.equal(await hint.evaluate(element => getComputedStyle(element).fontSize), '11px');
  assert.equal(await trigger('replyMode').getAttribute('aria-describedby'), await hint.getAttribute('id'));
  for (const [label, expected] of [['Direct', /@mention of the bot/], ['Addressed', /Nikita.*Socrates.*whole words, any case.*may stay silent/], ['All', /every incoming message/], ['Off', /Does not reply/]]) {
    await trigger('replyMode').click(); await list('replyMode').getByRole('option', { name: label, exact: true }).click();
    assert.match(await hint.textContent(), expected);
  }
  const picker = trigger('thinking');
  await picker.click();
  const pickerBox = await picker.boundingBox(), listBox = await list('thinking').boundingBox();
  assert.ok(listBox.y >= pickerBox.y + pickerBox.height, 'Thinking must open below its trigger');
  await list('thinking').getByRole('option', { name: 'low', exact: true }).click();
  assert.equal(await active.locator('select[name="thinking"]').inputValue(), 'low');
  assert.equal(await picker.textContent(), 'low');
  await picker.click(); await picker.press('ArrowDown'); await picker.press('Enter');
  assert.notEqual(await active.locator('select[name="thinking"]').inputValue(), 'low');
  await picker.click(); await picker.press('Escape');
  assert.equal(await picker.getAttribute('aria-expanded'), 'false');
  await picker.click(); await page.locator('.intro').click();
  assert.equal(await picker.getAttribute('aria-expanded'), 'false');
  await picker.click(); await list('thinking').getByRole('option', { name: 'high', exact: true }).click();
  await active.locator('textarea[name="character"]').fill('BROWSER_CHARACTER');
  assert.equal(await active.locator('input[name="customOn"]').isChecked(), true);
  await active.locator('textarea[name="customPrompt"]').fill('RETAINED_CUSTOM');
  await active.locator('input[name="customOn"]').uncheck();
  assert.equal(await active.locator('textarea[name="basePrompt"]').inputValue(), 'FIXTURE_BASE_SYSTEM');
  await active.locator('textarea[name="basePrompt"]').fill('RETAINED_BASE');
  await active.locator('input[name="baseOn"]').uncheck();
  await active.locator('input[name="toolsOn"]').uncheck();
  for (const name of ['memoryLimit', 'backgroundLimit']) {
    assert.equal(await active.locator(`input[name="${name}"]`).getAttribute('max'), '500');
    assert.equal(await active.locator(`input[name="${name}"]`).getAttribute('step'), '1');
  }
  await active.locator('input[name="memoryLimit"]').fill('3');
  assert.equal(await active.locator('[data-output="memoryLimit"]').textContent(), '3');
  await active.locator('input[name="memoryLimit"]').fill('37');
  assert.deepEqual(await active.locator('select[name="replyMode"] option').evaluateAll(items => items.map(item => [item.value, item.textContent])),
    [['mention_reply', 'Direct'], ['addressed', 'Addressed'], ['all', 'All'], ['off', 'Off']]);
  await trigger('replyMode').click(); await list('replyMode').getByRole('option', { name: 'Addressed', exact: true }).click();
  const dirtyRevision = (await (await get(endpoint)).json()).revision;
  for (const action of ['reset', 'restore']) {
    await active.locator(`[data-action="${action}"]`).click();
    assert.match(await active.locator('.feedback').textContent(), /Save or reload your edits/);
    assert.equal((await (await get(endpoint)).json()).revision, dirtyRevision);
    assert.equal(await active.locator('input[name="memoryLimit"]').inputValue(), '37');
  }
  await active.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent.startsWith('Saved.'));
  data = await (await get(endpoint)).json();
  assert.equal(data.profiles[0].settings.character, 'BROWSER_CHARACTER');
  assert.equal(data.profiles[0].settings.customOn, false);
  assert.equal(data.profiles[0].settings.customPrompt, 'RETAINED_CUSTOM');
  assert.equal(data.profiles[0].settings.memoryLimit, 37);
  assert.equal(data.profiles[0].settings.replyMode, 'addressed');
  assert.equal(data.profiles[0].settings.basePrompt, 'RETAINED_BASE');
  assert.equal(data.profiles[0].settings.baseOn, false);
  assert.equal(data.profiles[0].settings.toolsOn, false);
  let acceptDialogs = true;
  page.on('dialog', dialog => acceptDialogs ? dialog.accept() : dialog.dismiss());
  await active.locator('[data-action="reset"]').click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent === 'Fresh context started.');
  data = await (await get(endpoint)).json();
  assert.equal(data.profiles[0].settings.customOn, false);
  assert.equal(data.profiles[0].settings.customPrompt, 'RETAINED_CUSTOM');
  assert.match(await active.locator('[data-memory-scope]').textContent(), /since the last New Chat/);
  const browserReset = data;
  acceptDialogs = false;
  await active.locator('[data-action="restore"]').click();
  assert.equal((await (await get(endpoint)).json()).revision, browserReset.revision);
  acceptDialogs = true;
  await active.locator('[data-action="restore"]').click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent.startsWith('Retained history restored.'));
  data = await (await get(endpoint)).json();
  assert.notEqual(data.profiles[0].settings.memoryEpoch, browserReset.profiles[0].settings.memoryEpoch);
  assert.deepEqual(data.profiles[0].settings, { ...browserReset.profiles[0].settings,
    memoryEpoch: data.profiles[0].settings.memoryEpoch, memoryResetAt: 0 });
  assert.deepEqual(data.profiles.slice(1), browserReset.profiles.slice(1));
  assert.match(await active.locator('[data-memory-scope]').textContent(), /all retained messages/);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('section:not([hidden]) .profile-picker-trigger[data-field="thinking"]')?.disabled === false);
  assert.equal(await active.locator('input[name="customOn"]').isChecked(), false);
  assert.equal(await active.locator('textarea[name="customPrompt"]').inputValue(), 'RETAINED_CUSTOM');
  assert.equal(await active.locator('input[name="baseOn"]').isChecked(), false);
  assert.equal(await active.locator('input[name="toolsOn"]').isChecked(), false);
  assert.equal(await active.locator('textarea[name="basePrompt"]').inputValue(), 'RETAINED_BASE');
  assert.match(await active.locator('[data-memory-scope]').textContent(), /all retained messages/);
  assert.equal(await active.locator('input[name="memoryLimit"]').inputValue(), '37');
  await active.locator('input[name="baseOn"]').check();
  await active.locator('input[name="toolsOn"]').check();
  await active.locator('input[name="customOn"]').check();
  await active.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent.startsWith('Saved.'));
  data = await (await get(endpoint)).json();
  assert.equal(data.profiles[0].settings.customOn, true);
  assert.equal(data.profiles[0].settings.customPrompt, 'RETAINED_CUSTOM');
  // Tabs preserve draft DOM, URL/history and fixed navigation positions.
  const tabs = page.locator('#profile-tabs a');
  const positions = await tabs.evaluateAll(items => items.map(item => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y })));
  await active.locator('textarea[name="character"]').fill('UNSAVED_PROJECT_DRAFT');
  await tabs.filter({ hasText: 'CurveLab' }).click();
  assert.equal(new URL(page.url()).searchParams.get('chat'), 'curvelab');
  assert.equal(await active.locator('h2').textContent(), 'CurveLab');
  await active.locator('textarea[name="tail"]').fill('UNSAVED_CURVELAB_DRAFT');
  await tabs.filter({ hasText: 'Pi Web' }).click();
  assert.equal(await active.locator('textarea[name="character"]').inputValue(), 'UNSAVED_PROJECT_DRAFT');
  await page.goBack();
  assert.equal(await active.locator('textarea[name="tail"]').inputValue(), 'UNSAVED_CURVELAB_DRAFT');
  assert.deepEqual(await tabs.evaluateAll(items => items.map(item => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y }))), positions);
  assert.equal(context.pages().length, 1);
  // Remote clean updates sync, unrelated dirty drafts survive, same-profile conflicts refuse save.
  data = await (await get(endpoint)).json();
  const remote = id => Object.fromEntries(Object.entries(data.profiles.find(item => item.id === id).settings).filter(([key]) => !['memoryEpoch', 'memoryResetAt'].includes(key)));
  response = await post(endpoint + '/lightcone', { action: 'save', revision: data.revision, settings: { ...remote('lightcone'), character: 'REMOTE_LIGHTCONE' } });
  assert.equal(response.status, 200); data = await response.json();
  await tabs.filter({ hasText: 'LightCone' }).click();
  await page.waitForFunction(() => document.querySelector('[data-profile="lightcone"] textarea[name="character"]').value === 'REMOTE_LIGHTCONE');
  await tabs.filter({ hasText: 'CurveLab' }).click();
  assert.equal(await active.locator('textarea[name="tail"]').inputValue(), 'UNSAVED_CURVELAB_DRAFT');
  response = await post(endpoint + '/curvelab', { action: 'save', revision: data.revision, settings: { ...remote('curvelab'), tail: 'REMOTE_CURVELAB' } });
  assert.equal(response.status, 200); data = await response.json();
  await page.waitForFunction(() => document.querySelector('[data-profile="curvelab"] .feedback').textContent.includes('Changed on another device'));
  assert.equal(await active.locator('textarea[name="tail"]').inputValue(), 'UNSAVED_CURVELAB_DRAFT');
  await active.locator('button[type="submit"]').click();
  assert.ok((await active.locator('.feedback').textContent()).includes('Reload this page'));
  await active.locator('[data-action="restore"]').click();
  assert.ok((await active.locator('.feedback').textContent()).includes('Reload this page'));
  assert.equal((await (await get(endpoint)).json()).revision, data.revision);
  await tabs.filter({ hasText: 'My DM', exact: true }).click();
  assert.match(await active.locator('[data-reply-hint]').textContent(), /incoming private messages.*No tag, reply or name is needed/);
  assert.equal(await active.locator('input[name="backgroundLimit"]').isDisabled(), true);
  assert.equal(await active.locator('input[name="backgroundLimit"]').inputValue(), '0');
  assert.equal((await post(endpoint + '/owner_dm', { action: 'save', revision: data.revision, settings: { ...remote('owner_dm'), backgroundLimit: 1 } })).status, 400);
  response = await post(endpoint + '/guest_dm', { action: 'reset', revision: data.revision });
  assert.equal(response.status, 200); data = await response.json();
  assert.equal(data.profiles.find(item => item.id === 'guest_dm').settings.backgroundLimit, 0);
  assert.ok(data.profiles.find(item => item.id === 'guest_dm').settings.thinking);
  for (const count of [0, 3, 499, 500]) {
    const other = data.profiles.filter(item => item.id !== 'piwep');
    response = await post(endpoint + '/piwep', { action: 'save', revision: data.revision,
      settings: { ...remote('piwep'), memoryLimit: count, backgroundLimit: count } });
    assert.equal(response.status, 200); data = await response.json();
    assert.equal(data.profiles[0].settings.memoryLimit, count);
    assert.equal(data.profiles[0].settings.backgroundLimit, count);
    assert.deepEqual(data.profiles.filter(item => item.id !== 'piwep'), other);
  }
  // Both history actions work for all six profiles, including inherited/private defaults.
  for (const { id } of registry) {
    for (const action of ['restore', 'reset', 'restore', 'restore']) {
      const before = data;
      const previous = before.profiles.find(item => item.id === id).settings;
      response = await post(endpoint + '/' + id, { action, revision: before.revision });
      assert.equal(response.status, 200); data = await response.json();
      const next = data.profiles.find(item => item.id === id).settings;
      assert.notEqual(next.memoryEpoch, previous.memoryEpoch);
      assert.equal(action === 'restore' ? next.memoryResetAt === 0 : next.memoryResetAt > 0, true);
      assert.deepEqual(next, { ...previous, memoryEpoch: next.memoryEpoch, memoryResetAt: next.memoryResetAt });
      assert.deepEqual(data.profiles.filter(item => item.id !== id), before.profiles.filter(item => item.id !== id));
    }
  }
  const privateSettings = remote('guest_dm');
  response = await post(endpoint + '/guest_dm', { action: 'save', revision: data.revision,
    settings: { ...privateSettings, memory: false, memoryLimit: 3 } });
  assert.equal(response.status, 200); data = await response.json();
  for (const action of ['reset', 'restore']) {
    response = await post(endpoint + '/guest_dm', { action, revision: data.revision });
    assert.equal(response.status, 200); data = await response.json();
    const saved = data.profiles.find(item => item.id === 'guest_dm').settings;
    assert.equal(saved.memory, false); assert.equal(saved.memoryLimit, 3); assert.equal(saved.backgroundLimit, 0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => window.scrollTo(0, 0));
  const screenshots = process.env.PROFILES_SCREENSHOT_DIR || temp;
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'profiles-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(screenshots, 'profiles-desktop.png'), fullPage: true });
  await page.locator('#back-to-chat').click();
  await page.waitForSelector('.app-brand');
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(context.pages().length, 1);
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.addCookies([{ name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: origin }]);
  const mobile = await touch.newPage(); await mobile.goto(origin);
  const touchBrand = await mobile.locator('.app-brand').boundingBox();
  await mobile.locator('.app-brand').click();
  await mobile.waitForFunction(() => document.querySelector('.profile-picker-trigger[data-field="thinking"]')?.disabled === false);
  const mobileActive = mobile.locator('section:not([hidden])');
  for (const name of ['New Chat', 'Old Chat']) {
    const button = mobileActive.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, name + ' fits on mobile');
  }
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.evaluate(() => window.scrollTo(0, 0));
  const mobileFullscreen = await mobile.locator('#profile-fullscreen').boundingBox();
  assert.ok(mobileFullscreen.width >= 60 && mobileFullscreen.height >= 44);
  assert.ok(mobileFullscreen.y + mobileFullscreen.height <= (await mobile.locator('#profile-tabs a').first().boundingBox()).y);
  await mobile.locator('#profile-fullscreen').click(); await mobile.waitForFunction(() => Boolean(document.fullscreenElement));
  await mobile.locator('section:not([hidden]) textarea[name="tail"]').scrollIntoViewIfNeeded();
  assert.equal(await mobile.locator('section:not([hidden]) textarea[name="tail"]').isVisible(), true);
  await mobile.locator('#profile-fullscreen').click(); await mobile.waitForFunction(() => !document.fullscreenElement);
  assert.deepEqual(await mobile.locator('#back-to-chat').boundingBox(), touchBrand);
  for (const name of ['model', 'thinking', 'replyMode']) {
    const button = mobile.locator(`section:not([hidden]) .profile-picker-trigger[data-field="${name}"]`);
    await button.click();
    const mobileTrigger = await button.boundingBox();
    const mobileList = await mobile.locator(`section:not([hidden]) .profile-picker-list[data-field="${name}"]`).boundingBox();
    assert.ok(mobileList.y >= mobileTrigger.y + mobileTrigger.height);
    await button.press('Escape');
  }
  await touch.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'data/settings.json'))), baseline);
  console.log('PASS: actual authenticated HTTP, six same-tab profiles, stable navigation, retained drafts, clean autosync/dirty conflicts, private capabilities, New Chat/Old Chat/repeated restore/saved limits/off/confirmation/draft guards/revisions/global isolation, desktop/touch Chat geometry, identical downward Model/Thinking/Replies mouse/keyboard/touch selection, dynamic muted Replies help, shared chat/profile native fullscreen with mobile scrolling and safe hit area, and Chat return; no model calls.');
} catch (error) { console.error(log); throw error; }
finally { await browser?.close(); child?.kill('SIGTERM'); if (child && child.exitCode === null) await once(child, 'exit'); fs.rmSync(temp, { recursive: true, force: true }); }
