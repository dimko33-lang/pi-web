// Opt-in: real Pi, synthetic Telegram peers and a provider bound to loopback only.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.TEST_TELEGRAM_PYTHON || 'python3';
const pi = process.env.TEST_PI_BIN || 'pi';
const options = {cwd: root, stdio: 'inherit', env: {...process.env, PYTHONDONTWRITEBYTECODE:'1', TEST_TELEGRAM_PYTHON:python, TEST_PI_BIN:pi, PI_WEB_PI_BIN:pi}};
for (const name of ['turn-wait','telegram-transport','individual-dms','dm-memory','participant-memory','group-replies','reply-recovery','showcase-reply','voice-notes','spoken-reply','telegram-archive']) {
  console.log(`Testing ${name}`); execFileSync(python, ['-B',`tests/${name}.py`], options);
}
execFileSync(process.execPath, ['--import','tsx','tests/request-inspection.mjs'], options);
