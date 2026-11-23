// Preserve native apt/pip/build output. Elapsed time means the command is still running,
// not that a download has advanced or that a completion percentage is known.
import {spawn} from 'node:child_process';
import {constants} from 'node:os';
import {performance} from 'node:perf_hooks';
const [label, command, ...args] = process.argv.slice(2);
if (!label || !command) throw Error('Expected a stage label and a command');
const start = performance.now();
function report(status) {
  const seconds = Math.floor((performance.now() - start) / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  console.error(`[${elapsed}] ${label}: ${status}`);
}
report('starting');
const child = spawn(command, args, {stdio: ['ignore', 'inherit', 'inherit']});
const timer = setInterval(() => report('still running'), 10000);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => child.kill(signal));
child.on('error', err => console.error(`${label}: ${err.message}`));
child.once('close', (code, signal) => {
  clearInterval(timer);
  const status = code === null ? 128 + (constants.signals[signal] || 0) : code < 0 ? 1 : code;
  report(status === 0 ? 'done' : `failed (${signal || status})`);
  process.exitCode = status;
});
