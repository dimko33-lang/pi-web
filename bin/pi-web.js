#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const BOOTSTRAP_URL =
  process.env.PI_BOOTSTRAP_URL ||
  'https://raw.githubusercontent.com/dimko33-lang/pi-web-agent/main/bootstrap.sh';

function hasInteractiveTty() {
  if (process.stdin.isTTY) return true;
  try {
    fs.accessSync('/dev/tty', fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function hasAnyInstallerKey() {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.KIMI_API_KEY
  );
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        return download(res.headers.location, dest).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }

      const file = fs.createWriteStream(dest, { mode: 0o700 });
      res.pipe(file);

      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const isPostinstall = process.argv.includes('--postinstall');

  if (isPostinstall && process.env.PI_WEB_SKIP_POSTINSTALL === '1') {
    process.exit(0);
  }

  if (isPostinstall && process.env.npm_config_global !== 'true') {
    process.exit(0);
  }

  if (process.platform !== 'linux') {
    if (isPostinstall) process.exit(0);
    console.error('This installer is for Linux servers.');
    process.exit(1);
  }

  if (isPostinstall && !hasInteractiveTty() && !hasAnyInstallerKey()) {
    console.log('==> Package installed.');
    console.log('==> No interactive terminal detected during postinstall.');
    console.log('==> Run "pi-web" manually to start setup.');
    process.exit(0);
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `pi-web-bootstrap-${Date.now()}.sh`
  );

  let exitCode = 1;

  try {
    console.log('==> Downloading bootstrap.sh');
    await download(BOOTSTRAP_URL, tmpFile);

    console.log('==> Running installer');
    const result = spawnSync('bash', [tmpFile], {
      stdio: 'inherit',
      env: process.env
    });

    if (result.error) throw result.error;
    exitCode = result.status ?? 0;
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    exitCode = 1;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
  }

  process.exit(exitCode);
}

main();
