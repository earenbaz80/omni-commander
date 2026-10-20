// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { calculateFileHashes } from './fileSystemCrypto';
import { FileItem } from '../types';

/**
 * A checksum that is not a hash of the file's bytes is worse than no checksum:
 * the user copies it, verifies a download elsewhere and gets a false negative
 * (or, worse, a false match). These tests pin the contract that a real-drive
 * file is hashed by the server from its actual bytes, while an in-memory file
 * that only exists as `content` is still hashed locally.
 *
 * The server is spawned for real so the digests are computed by Node's crypto
 * over a known fixture, not asserted against a hand-written mock.
 */

const PORT = 3998;
const TOKEN = randomBytes(32).toString('hex');
let child: ChildProcess | null = null;
let scratchDir = '';
let fixturePath = '';
let fixtureBytes: Buffer;

const tryConnect = (port: number, timeoutMs = 1000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

beforeAll(async () => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-crypto-'));
  fixturePath = path.join(scratchDir, 'fixture.bin');
  fixtureBytes = Buffer.from('The quick brown fox jumps over the lazy dog', 'utf8');
  fs.writeFileSync(fixturePath, fixtureBytes);

  child = spawn(process.execPath, [process.env.OMNI_TEST_SERVER_CJS || 'server.cjs'], {
    env: { ...process.env, PORT: String(PORT), OMNI_SESSION_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await tryConnect(PORT)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start in time');
}, 30000);

afterAll(() => {
  child?.kill();
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    /* scratch dir outside the worktree; nothing depends on the cleanup */
  }
});

/** A FileItem shaped like a real-drive listing row: content is always empty. */
function realDriveFile(): FileItem {
  return {
    id: 'real_file_1',
    name: 'fixture',
    ext: 'bin',
    fullName: 'fixture.bin',
    path: scratchDir,
    driveId: 'real_T',
    isDirectory: false,
    size: fixtureBytes.length,
    modifiedAt: '2026-01-01 00:00:00',
    createdAt: '2026-01-01 00:00:00',
    attributes: { readOnly: false, hidden: false, system: false, archive: true },
    content: '',
  };
}

const expected = (algorithm: string) =>
  createHash(algorithm).update(fixtureBytes).digest('hex');

describe('calculateFileHashes', () => {
  beforeEach(() => {
    // The renderer reaches the server through the preload bridge; give it the
    // loopback port and the per-launch token the same way Electron does.
    vi.stubGlobal('window', {
      electronAPI: { isElectron: true, apiPort: PORT, apiToken: TOKEN },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hashes a real-drive file from its bytes through the server route', async () => {
    const result = await calculateFileHashes(realDriveFile());

    expect(result.md5).toBe(expected('md5'));
    expect(result.sha1).toBe(expected('sha1'));
    expect(result.sha256).toBe(expected('sha256'));
    // The old fallback hashed `name.ext_size_modifiedAt` and never matched the
    // file. Any lingering fabricated value would fail the assertions above.
    expect(result.sha256).not.toBe(
      createHash('sha256')
        .update('fixture.bin.42_2026-01-01 00:00:00')
        .digest('hex')
    );
  });

  it('hashes in-memory content locally without a server call', async () => {
    const content = 'in-memory payload';
    const file: FileItem = {
      ...realDriveFile(),
      id: 'mem_1',
      driveId: 'host_fs',
      content,
    };

    const result = await calculateFileHashes(file);
    const bytes = Buffer.from(content, 'utf8');

    expect(result.md5).toBe(createHash('md5').update(bytes).digest('hex'));
    expect(result.sha1).toBe(createHash('sha1').update(bytes).digest('hex'));
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('surfaces an error instead of fabricating a digest when bytes cannot be read', async () => {
    const missing: FileItem = {
      ...realDriveFile(),
      id: 'real_missing',
      fullName: 'does-not-exist.bin',
      path: path.join(scratchDir, 'missing'),
    };

    await expect(calculateFileHashes(missing)).rejects.toThrow();
  });
});

/**
 * The loopback API is reachable from the user's browser. Without an origin
 * check plus a per-launch secret, any web page -- including a sandboxed iframe
 * whose opaque origin the browser reports as "null" -- could POST to
 * /api/fs/delete and wipe the disk. These tests drive the real server over
 * HTTP so the refusal is proven end to end.
 */
const baseUrl = `http://127.0.0.1:${PORT}`;

async function post(pathname: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('loopback API origin and token enforcement (S1)', () => {
  it('refuses a mutating request that carries no session token', async () => {
    const res = await post('/api/fs/mkdir', { path: path.join(scratchDir, 'nope') });
    expect(res.status).toBe(403);
  });

  it('accepts a mutating request that carries the correct session token', async () => {
    const res = await post(
      '/api/fs/mkdir',
      { path: path.join(scratchDir, 'allowed') },
      { 'x-omni-token': TOKEN },
    );
    expect(res.status).not.toBe(403);
    expect(res.ok).toBe(true);
  });

  it('rejects the opaque "null" origin used by sandboxed iframes (no token)', async () => {
    const res = await post(
      '/api/fs/mkdir',
      { path: path.join(scratchDir, 'evil') },
      { origin: 'null' },
    );
    expect(res.status).toBe(403);
  });

  it('allows the packaged file:// renderer (null origin) when it carries the token', async () => {
    const res = await post(
      '/api/fs/mkdir',
      { path: path.join(scratchDir, 'packaged') },
      { origin: 'null', 'x-omni-token': TOKEN },
    );
    expect(res.status).not.toBe(403);
    expect(res.ok).toBe(true);
  });

  it('rejects a remote origin even with a valid token present', async () => {
    const res = await post(
      '/api/fs/mkdir',
      { path: path.join(scratchDir, 'evil2') },
      { origin: 'https://evil.example', 'x-omni-token': TOKEN },
    );
    expect(res.status).toBe(403);
  });

  it('still serves same-origin GETs used by the built-in dashboard', async () => {
    const res = await fetch(`${baseUrl}/api/fs/dashboard`, {
      headers: { origin: 'http://127.0.0.1:3000' },
    });
    expect(res.ok).toBe(true);
  });
});

/**
 * Copy integrity: the destination must never be truncated before the new bytes
 * are complete, and a write error must fail one job without taking the server
 * down (which would kill every sibling job too).
 */
describe('copy integrity and job isolation (S2, S3)', () => {
  const jobsUrl = `${baseUrl}/api/fs/job`;

  async function waitForJob(id: string, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${jobsUrl}/${id}`);
      if (res.ok) {
        const job = await res.json();
        if (job.status !== 'running' && job.status !== 'paused' && job.status !== 'waiting') return job;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    throw new Error(`job ${id} did not finish`);
  }

  it('leaves no temp debris and produces the exact bytes on a completed copy', async () => {
    const destDir = fs.mkdtempSync(path.join(scratchDir, 'dest-'));
    const res = await post(
      '/api/fs/copy',
      { sources: [fixturePath], targetDir: destDir, collision: 'overwrite' },
      { 'x-omni-token': TOKEN },
    );
    expect(res.ok).toBe(true);
    const { jobId } = await res.json();
    const finished = await waitForJob(jobId);
    expect(finished.status).toBe('done');

    const finalPath = path.join(destDir, 'fixture.bin');
    expect(fs.readFileSync(finalPath)).toEqual(fixtureBytes);
    // The interrupted-copy contract: no `.omni-part-` file survives success.
    const leftovers = fs.readdirSync(destDir).filter((n) => n.includes('.omni-part-'));
    expect(leftovers).toEqual([]);
  });

  it('does not truncate an existing destination when the copy is cancelled mid-transfer', async () => {
    const destDir = fs.mkdtempSync(path.join(scratchDir, 'cancel-dest-'));
    const srcDir = fs.mkdtempSync(path.join(scratchDir, 'cancel-src-'));
    const bigSrc = path.join(srcDir, 'big.bin');
    // Large enough that the transfer is still in flight when cancel lands.
    fs.writeFileSync(bigSrc, Buffer.alloc(2 * 1024 * 1024, 0x5a));

    const finalPath = path.join(destDir, 'big.bin');
    const originalBytes = Buffer.from('ORIGINAL DESTINATION CONTENT', 'utf8');
    fs.writeFileSync(finalPath, originalBytes);

    const res = await post(
      '/api/fs/copy',
      { sources: [bigSrc], targetDir: destDir, collision: 'overwrite', throttleBps: 128 * 1024 },
      { 'x-omni-token': TOKEN },
    );
    expect(res.ok).toBe(true);
    const { jobId } = await res.json();

    // Let the copy start writing, then cancel.
    await new Promise((r) => setTimeout(r, 400));
    await post(`/api/fs/job/${jobId}/cancel`, {}, { 'x-omni-token': TOKEN });
    const finished = await waitForJob(jobId, 25000);
    expect(finished.status).toBe('cancelled');

    // The original destination must be byte-for-byte intact: it was never
    // opened for writing until the copy completed.
    expect(fs.readFileSync(finalPath)).toEqual(originalBytes);
    // The partial temp must be cleaned up on cancel.
    const leftovers = fs.readdirSync(destDir).filter((n) => n.includes('.omni-part-'));
    expect(leftovers).toEqual([]);
  }, 30000);

  it('does not destroy an existing destination when the copy fails, and keeps the server alive', async () => {
    const destDir = fs.mkdtempSync(path.join(scratchDir, 'fail-dest-'));
    // A directory sitting where the file must land makes the writer stream fail
    // with EISDIR after the destination "exists" -- the failure path must not
    // truncate anything and must not crash the process.
    fs.mkdirSync(path.join(destDir, 'fixture.bin'));

    const res = await post(
      '/api/fs/copy',
      { sources: [fixturePath], targetDir: destDir, collision: 'overwrite' },
      { 'x-omni-token': TOKEN },
    );
    expect(res.ok).toBe(true);
    const { jobId } = await res.json();
    const finished = await waitForJob(jobId);

    // The job reports the failure instead of the process dying.
    expect(finished.status === 'done-with-errors' || finished.status === 'error').toBe(true);
    expect(finished.errors.length).toBeGreaterThan(0);
    // No partial temp file is left behind.
    const leftovers = fs.readdirSync(destDir).filter((n) => n.includes('.omni-part-'));
    expect(leftovers).toEqual([]);

    // The server survived: a fresh request still answers.
    const alive = await fetch(`${baseUrl}/api/fs/dashboard`);
    expect(alive.ok).toBe(true);
  });
});
