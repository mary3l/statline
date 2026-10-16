import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';

/**
 * PGlite is a single-process database: two processes on one data folder corrupt it.
 * This lock file (next to the folder) holds the owner's pid and a heartbeat the owner refreshes.
 * A second process waits a few seconds (a restarting dev server needs a moment to let go), then refuses to start.
 * A lock is abandoned when its owner is gone or its heartbeat is old: Windows reuses pids, so the pid alone can't tell.
 */
const WAIT_MS = 6000;
const HEARTBEAT_MS = 5000;
const STALE_MS = 30_000;

interface Lock {
  pid: number;
  at: number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(lockPath: string): Lock | null {
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    // Older locks held just the pid; give them no heartbeat so only the pid decides.
    if (/^\d+$/.test(raw)) return { pid: Number(raw), at: Date.now() };
    const l = JSON.parse(raw) as Lock;
    return typeof l.pid === 'number' && typeof l.at === 'number' ? l : null;
  } catch {
    return null;
  }
}

const mine = () => JSON.stringify({ pid: process.pid, at: Date.now() } satisfies Lock);

function tryTake(lockPath: string): number | null {
  try {
    const fd = openSync(lockPath, 'wx');
    writeSync(fd, mine());
    closeSync(fd);
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const holder = readLock(lockPath);
  if (holder && holder.pid !== process.pid && alive(holder.pid) && Date.now() - holder.at < STALE_MS) return holder.pid;
  // Abandoned (owner gone, heartbeat stale, or unreadable): remove it and race for it again.
  try {
    unlinkSync(lockPath);
  } catch {
    // Someone else removed it first.
  }
  return tryTake(lockPath);
}

export async function lockPglite(dir: string, opts: { waitMs?: number } = {}): Promise<() => void> {
  const lockPath = `${path.resolve(dir)}.lock`;
  const deadline = Date.now() + (opts.waitMs ?? WAIT_MS);
  let holder = tryTake(lockPath);
  while (holder !== null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    holder = tryTake(lockPath);
  }
  if (holder !== null) {
    throw new Error(
      `The embedded database in ${dir} is already open in process ${holder} (another API, seed or watcher). ` +
        'Stop that process first: PGlite allows one process at a time, and two would corrupt it.',
    );
  }
  const heartbeat = setInterval(() => {
    try {
      if (readLock(lockPath)?.pid === process.pid) writeFileSync(lockPath, mine());
    } catch {
      // The next beat tries again.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  const release = () => {
    clearInterval(heartbeat);
    try {
      if (readLock(lockPath)?.pid === process.pid) unlinkSync(lockPath);
    } catch {
      // Already gone.
    }
  };
  process.once('exit', release);
  return release;
}
