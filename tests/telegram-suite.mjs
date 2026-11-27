// Opt-in: real Pi, synthetic Telegram peers and a provider bound to loopback only.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.TEST_TELEGRAM_PYTHON || 'python3';
const pi = process.env.TEST_PI_BIN || 'pi';
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'nikita-test-telegram-'));
try {
  const state = path.join(temp,'state'), data = path.join(temp,'data');
  for (const dir of [state,data]) fs.mkdirSync(dir,{mode:0o700});
  const options = {cwd:root, stdio:'inherit', env:{...process.env, NIKITA_INSTANCE_DIR:state, PI_WEB_TELEGRAM_DATA:data, NIKITA_PI_IDLE_SECONDS:'1200', PYTHONDONTWRITEBYTECODE:'1', TEST_TELEGRAM_PYTHON:python, TEST_PI_BIN:pi, PI_WEB_PI_BIN:pi}};
  for (const name of ['turn-wait','telegram-transport','individual-dms','dm-memory','participant-memory','group-photos','group-replies','reply-recovery','showcase-reply','voice-notes','spoken-reply','telegram-archive','heygen-circles']) {
    console.log(`Testing ${name}`); execFileSync(python, ['-B',`tests/${name}.py`], options);
  }
  execFileSync(process.execPath, ['--import','tsx','tests/request-inspection.mjs'], options);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
