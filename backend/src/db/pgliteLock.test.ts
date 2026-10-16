import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lockPglite } from './pgliteLock.js';

let dir: string;
const lockFile = () => `${path.resolve(dir)}.lock`;

afterEach(() => {
  rmSync(lockFile(), { force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe('PGlite lock', () => {
  it('writes its pid and heartbeat, and removes the lock on release', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'statline-lock-'));
    const release = await lockPglite(dir);
    expect(JSON.parse(readFileSync(lockFile(), 'utf8'))).toMatchObject({ pid: process.pid, at: expect.any(Number) });
    release();
    expect(existsSync(lockFile())).toBe(false);
  });

  it('refuses while another live process holds a fresh lock', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'statline-lock-'));
    // The parent process (the test runner) is alive.
    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, at: Date.now() }));
    await expect(lockPglite(dir, { waitMs: 300 })).rejects.toThrow(/already open in process/);
  });

  it('takes over a lock whose owner is gone or whose heartbeat is old (pids get reused)', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'statline-lock-'));
    writeFileSync(lockFile(), JSON.stringify({ pid: 999_999, at: Date.now() }));
    (await lockPglite(dir, { waitMs: 300 }))();

    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, at: Date.now() - 60_000 }));
    const release = await lockPglite(dir, { waitMs: 300 });
    expect(JSON.parse(readFileSync(lockFile(), 'utf8')).pid).toBe(process.pid);
    release();
  });
});
