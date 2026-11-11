// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, WINDOWS_PROCESS_CASE_TIMEOUT_MS, type TestServer } from '@/scripts/serverHarness';

/**
 * Emptying a whole folder is the one operation in this app that can destroy work
 * the user never named, so the guarantees matter more than the happy path:
 *
 * - the request names a target, never a path, so it cannot be pointed at C:\;
 * - the age filter decides what goes, and a fresh file (a running installer's
 *   temporary, say) must survive;
 * - a reparse point inside the folder is never followed, or a junction would
 *   turn "empty the temp folder" into "delete this other folder";
 * - an entry another program holds open is reported, and the rest of the run
 *   still happens.
 *
 * The suite points the user temp target at a scratch folder through
 * OMNI_CLEANUP_USER_TEMP_ROOT, because the alternative is deleting the machine's
 * real temporary files.
 *
 * The open handle is held by PowerShell on purpose. Node opens files with
 * FILE_SHARE_DELETE, so a file this process keeps open still deletes, and so does
 * one carrying the read-only attribute; neither reproduces "another program is
 * using it", which is the case the run has to survive.
 */
const OLD_DAYS = 30;
const DELETABLE_BYTES = 1000 + 2000 + 3000;
const IN_USE_BYTES = 700;
const FRESH_BYTES = 20 + 50;

let server: TestServer;
let locker: ChildProcess | null = null;
let root = '';
let outside = '';
let inUsePath = '';
let lockMarker = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const post = async (route: string, body: unknown) => {
  const response = await fetch(server.url(`/api/fs/${route}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
};

/** Writes a file of `bytes` and backdates it so it counts as old. */
const writeOld = (relative: string, bytes: number) => {
  const full = path.join(root, relative);
  fs.writeFileSync(full, Buffer.alloc(bytes, 7));
  const past = new Date(Date.now() - OLD_DAYS * 24 * 60 * 60 * 1000);
  fs.utimesSync(full, past, past);
};

/** Backdates a directory itself, which is what makes it removable. */
const backdateDir = (relative: string) => {
  const past = new Date(Date.now() - OLD_DAYS * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(root, relative), past, past);
};

const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Holds `inUsePath` open with FileShare.None, which is what an ordinary Windows
 * program does. Returns only once the handle is held (the marker file is written
 * after the open succeeded) and raises if the lock never takes hold, so a failure
 * here is not mistaken for a cleanup bug.
 */
async function holdFileOpen(filePath: string): Promise<void> {
  lockMarker = path.join(os.tmpdir(), `omni-cleanup-lock-${process.pid}.marker`);
  const script =
    "$ErrorActionPreference='Stop';" +
    `$held=[System.IO.File]::Open(${psQuote(filePath)},'Open','Read','None');` +
    `Set-Content -LiteralPath ${psQuote(lockMarker)} -Value 'locked';` +
    'Start-Sleep -Seconds 120';
  locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });

  // PowerShell starts in about a second when the machine is idle and has been
  // measured past ten while the rest of the suite saturated the box, which is
  // how this suite went red with nothing wrong in the cleanup code. Thirty
  // seconds is a budget for a cold process, not a longer wait for a broken
  // lock: the marker file still has to prove the handle is held before any
  // test runs, and it is removed the moment the holder dies.
  for (let attempt = 0; attempt < 300; attempt++) {
    if (fs.existsSync(lockMarker)) {
      // Proof the handle really denies others: with FileShare.None even a read
      // open fails, while Node's own open (share-delete) would have succeeded.
      let denied = false;
      try {
        fs.closeSync(fs.openSync(filePath, 'r'));
      } catch {
        denied = true;
      }
      if (denied) return;
    }
    await sleep(100);
  }
  throw new Error('could not lock the scratch file: PowerShell did not take the handle');
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cleanup-root-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cleanup-outside-'));

  // Old tree: three files that should go, plus the folders holding them.
  fs.mkdirSync(path.join(root, 'vieja', 'sub'), { recursive: true });
  writeOld('viejo-a.bin', 1000);
  writeOld(path.join('vieja', 'medio.bin'), 2000);
  writeOld(path.join('vieja', 'sub', 'fondo.bin'), 3000);
  backdateDir('vieja');
  backdateDir(path.join('vieja', 'sub'));

  // Fresh entries: a file at the root and a folder made just now.
  fs.writeFileSync(path.join(root, 'suelto-nuevo.txt'), Buffer.alloc(50, 1));
  fs.mkdirSync(path.join(root, 'nueva'));
  fs.writeFileSync(path.join(root, 'nueva', 'fresco.txt'), Buffer.alloc(20, 1));

  // An old file another program is using.
  inUsePath = path.join(root, 'en-uso.bin');
  writeOld('en-uso.bin', IN_USE_BYTES);
  await holdFileOpen(inUsePath);

  // A junction pointing outside the folder. The file it points at is old on
  // purpose: otherwise a walk that followed the junction would find only a fresh
  // entry there, nothing would be deleted, and the test would pass while the bug
  // it is meant to catch stayed hidden.
  fs.symlinkSync(outside, path.join(root, 'enlace-externo'), 'junction');
  const externalFile = path.join(outside, 'importante.txt');
  fs.writeFileSync(externalFile, Buffer.alloc(999, 9));
  const past = new Date(Date.now() - OLD_DAYS * 24 * 60 * 60 * 1000);
  fs.utimesSync(externalFile, past, past);

  server = await startServer({
    env: { OMNI_SESSION_TOKEN: '', OMNI_CLEANUP_USER_TEMP_ROOT: root },
  });
}, WINDOWS_PROCESS_CASE_TIMEOUT_MS);

afterAll(async () => {
  await server.stop();
  locker?.kill();

  // The file held open cannot be deleted until the holding process is gone, and
  // Windows releases the handle a moment after the kill, so removal is retried
  // instead of swallowed: a bare catch here left a scratch folder behind on
  // every run.
  const remove = async (target: string): Promise<void> => {
    if (!target) return;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch {
        /* the handle is still closing */
      }
      if (!fs.existsSync(target)) return;
      await sleep(150);
    }
    console.warn(`[cleanup test] could not remove the scratch path: ${target}`);
  };

  await remove(lockMarker);
  await remove(root);
  await remove(outside);
}, 20000);

describe('POST /api/fs/cleanup/targets', () => {
  it('offers the three folders and flags the two that need elevation', async () => {
    const { status, body } = await post('cleanup/targets', {});

    expect(status).toBe(200);
    expect(body.targets.map((target: any) => target.id)).toEqual(['user-temp', 'windows-temp', 'prefetch']);
    const user = body.targets.find((target: any) => target.id === 'user-temp');
    expect(user.requiresAdmin).toBe(false);
    expect(user.exists).toBe(true);
    // The test hook redirects the user temp target only, and this proves it.
    expect(String(user.path).toLowerCase()).toBe(path.win32.normalize(root).toLowerCase());
    for (const id of ['windows-temp', 'prefetch']) {
      expect(body.targets.find((target: any) => target.id === id).requiresAdmin).toBe(true);
    }
  });
});

describe('POST /api/fs/cleanup/scan', () => {
  it('counts what the age filter would remove, and nothing else', async () => {
    const { status, body } = await post('cleanup/scan', { target: 'user-temp', minAgeDays: 1 });

    expect(status).toBe(200);
    expect(body.files).toBe(4); // three old files plus the one in use
    expect(body.bytes).toBe(DELETABLE_BYTES + IN_USE_BYTES);
    expect(body.dirs).toBe(2); // vieja and vieja/sub, both backdated and free of anything fresh
    expect(body.truncated).toBe(false);
  });

  it('never follows a reparse point out of the folder', async () => {
    const { body } = await post('cleanup/scan', { target: 'user-temp', minAgeDays: 1 });

    // The external file is 999 bytes; following the junction would show it up in
    // the total and in the largest list.
    expect(body.bytes).toBe(DELETABLE_BYTES + IN_USE_BYTES);
    expect(body.largest.map((entry: any) => entry.name)).not.toContain('importante.txt');
    expect(body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('counts the fresh entries only when the filter asks for everything', async () => {
    const { body } = await post('cleanup/scan', { target: 'user-temp', minAgeDays: 0 });

    expect(body.files).toBe(6); // the four old ones plus the two fresh ones
    expect(body.bytes).toBe(DELETABLE_BYTES + IN_USE_BYTES + FRESH_BYTES);
  });

  it('refuses a target that needs elevation instead of trying', async () => {
    const { status, body } = await post('cleanup/scan', { target: 'prefetch', minAgeDays: 0 });

    expect(status).toBe(400);
    expect(body.error).toBe('prefetch needs administrator rights');
  });

  it('refuses a path sent where a target belongs', async () => {
    const { status, body } = await post('cleanup/scan', { target: 'C:\\', minAgeDays: 0 });

    expect(status).toBe(400);
    expect(body.error).toContain('Unknown cleanup target');
  });
});

describe('POST /api/fs/cleanup/run', () => {
  // The run deletes a file PowerShell is holding with FileShare.None, so how long
  // the refusal takes is up to that process, not to this one.
  it(
    'empties the old entries, keeps the fresh ones and reports what it could not remove',
    async () => {
      const { status, body } = await post('cleanup/run', { target: 'user-temp', minAgeDays: 1 });

      expect(status).toBe(200);
      expect(body.deletedFiles).toBe(3);
      expect(body.deletedDirs).toBe(2);
      // The file in use is reported, never counted as freed space.
      expect(body.freedBytes).toBe(DELETABLE_BYTES);
      expect(body.failedCount).toBe(1);
      expect(String(body.failed[0].path).toLowerCase()).toBe(inUsePath.toLowerCase());

      expect(fs.existsSync(path.join(root, 'viejo-a.bin'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'vieja'))).toBe(false);

      // Fresh entries survive the run.
      expect(fs.readFileSync(path.join(root, 'suelto-nuevo.txt')).length).toBe(50);
      expect(fs.readFileSync(path.join(root, 'nueva', 'fresco.txt')).length).toBe(20);

      // The junction was left alone, and so was everything it points at.
      expect(fs.existsSync(path.join(root, 'enlace-externo'))).toBe(true);
      expect(fs.readFileSync(path.join(outside, 'importante.txt')).length).toBe(999);

      // The file it could not delete is still there, as reported.
      expect(fs.existsSync(inUsePath)).toBe(true);
    },
    WINDOWS_PROCESS_CASE_TIMEOUT_MS,
  );

  it('refuses a target that needs elevation', async () => {
    const { status, body } = await post('cleanup/run', { target: 'prefetch', minAgeDays: 0 });

    expect(status).toBe(400);
    expect(body.error).toBe('prefetch needs administrator rights');
  });
});
