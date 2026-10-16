/**
 * `npm run dev`: runs the API and restarts it when a file in src/ changes (type `rs` + Enter to restart by hand).
 * Replaces `tsx watch`, which stops the API with child.kill(): on Windows that ends it at once, so the API never
 * closes its database. Here the API is asked to shut down over IPC and gets a few seconds to close cleanly.
 * Nothing is left behind holding the port and database: if this runner is killed, the API goes with it
 * (Windows ends it with us; elsewhere it sees the IPC channel close), and if npm is force-killed, which leaves
 * `tsx watch` running on Windows, this runner notices its parent is gone and stops the API first.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STOP_MS = 5000;
const srcDir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(srcDir, 'server.ts');

let child: ChildProcess | undefined;
let quitting = false;

function start() {
  // fork() passes on this process's --import tsx, and opens the IPC channel the API listens on.
  const c = fork(entry, process.argv.slice(2), { stdio: 'inherit' });
  child = c;
  c.once('exit', (code, signal) => {
    if (child === c) child = undefined;
    if (!quitting && code !== 0 && signal === null) console.log(`[dev] API exited with code ${code}; waiting for a change.`);
  });
}

function stop(): Promise<void> {
  const c = child;
  if (!c || c.exitCode !== null || c.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      console.log(`[dev] API didn't stop within ${STOP_MS / 1000}s; killing it.`);
      c.kill('SIGKILL');
    }, STOP_MS);
    c.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    if (c.connected) c.send('shutdown');
    else c.kill('SIGTERM');
  });
}

// Restarts are serialized: a burst of saves while the API is stopping becomes one restart.
let pending: NodeJS.Timeout | undefined;
let restarting: Promise<void> | undefined;
function restart(why: string) {
  clearTimeout(pending);
  pending = setTimeout(async () => {
    await restarting;
    if (quitting) return;
    console.log(`[dev] ${why}, restarting…`);
    restarting = stop().then(() => {
      if (!quitting) start();
    });
  }, 150);
}

async function quit() {
  if (quitting) return;
  quitting = true;
  clearTimeout(pending);
  await restarting;
  await stop();
  process.exit(0);
}

watch(srcDir, { recursive: true }, (_event, file) => {
  if (!file || !/\.(ts|json)$/.test(file) || /\.test\.ts$/.test(file)) return;
  restart(`${file.replaceAll('\\', '/')} changed`);
});
process.stdin.on('data', (d) => {
  if (String(d).trim() === 'rs') restart('rs');
});
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('SIGHUP', quit);
// Started by npm: if npm is force-killed, nothing is left to stop us, so notice and stop the API.
const parent = process.ppid;
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') void quit();
  }
}, 2000).unref();

start();
