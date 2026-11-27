import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: [process.argv[2]], bundle: true, write: false,
  platform: 'node', format: 'esm', nodePaths: ['/opt/pi-web-runtime/node_modules'] });
const extension = (await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))).default;
for (const [role, expected] of [
  ['public_research', ['web_search', 'web_read', 'lightcone_archive', 'generate_image']],
  ['lightcone', ['web_search', 'web_read', 'lightcone_archive', 'science', 'generate_image']],
  ['debri', ['web_search', 'web_read', 'lightcone_archive', 'science', 'generate_image']],
  ['guest', ['web_search', 'web_read', 'send_article', 'workspace', 'generate_image']],
  ['channel', ['web_search','web_read','workspace','telegram_read','lightcone_archive','generate_image']],
  ['channel_owner', ['web_search','web_read','workspace','telegram_read','lightcone_archive','telegram_draft','telegram_send','generate_image']],
  ['owner', ['web_search','web_read','send_article','workspace','generate_image','read','bash','edit','write','telegram_read','telegram_draft','telegram_send','manage_access','restart_assistant','lightcone_archive','science']]
]) {
  process.env.NIKITA_ROLE = role;
  const registered = new Set(); let start, active;
  extension({ registerTool: tool => registered.add(tool.name), on: (name, callback) => { if (name === 'session_start') start = callback; }, setActiveTools: names => { active = names; } });
  start(); assert.deepEqual(active, expected);
  for (const name of expected) if (!['read','bash','edit','write'].includes(name)) assert.ok(registered.has(name), name);
  if (role === 'public_research') assert.ok(!registered.has('science') && !registered.has('telegram_send'));
}
console.log('PASS actual bundled extension: narrow image tool in all seven roles; existing shell/research/approval boundaries unchanged; no tool execution/provider calls.');
