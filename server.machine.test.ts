// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The command bar used to print a fixed adapter, a fixed process table and a
 * four-line tree that described no folder. These routes are the real answer, so
 * the assertions compare them against what Node itself can see.
 */
let server: TestServer;
let scratch = '';

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-machine-'));
  await fs.mkdir(path.join(scratch, 'alpha', 'beta'), { recursive: true });
  await fs.mkdir(path.join(scratch, 'gamma'), { recursive: true });
}, 40000);

afterAll(async () => {
  await server?.stop();
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
});

describe('GET /api/net/adapters', () => {
  it('reports the IPv4 addresses this machine actually has', async () => {
    const res = await fetch(server.url('/api/net/adapters'));
    expect(res.status).toBe(200);
    const adapters = (await res.json()) as { name: string; address: string; netmask: string }[];

    expect(Array.isArray(adapters)).toBe(true);
    expect(adapters.length).toBeGreaterThan(0);

    // Every address must belong to an interface os.networkInterfaces() lists,
    // which is the difference between a reading and an invention.
    const known = new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter((entry) => entry && entry.family === 'IPv4')
        .map((entry) => entry!.address),
    );
    for (const adapter of adapters) {
      expect(known.has(adapter.address)).toBe(true);
      expect(adapter.address).not.toBe('192.168.1.150');
      expect(adapter.name.length).toBeGreaterThan(0);
    }
  });
});

describe('GET /api/processes', () => {
  it('reads the real process list', async () => {
    // The body is what says why a read failed — a timed-out child and a refused
    // spawn look identical from the status code alone.
    const read = async () => {
      const res = await fetch(server.url('/api/processes'));
      return { status: res.status, body: await res.text() };
    };

    // `tasklist` answers in about a second on an idle desktop, but this test asks
    // the OS to spawn a process while the rest of the suite saturates the box,
    // and the server's own 60 s budget has been outrun that way. A second read
    // separates a saturated moment from an endpoint that cannot read processes at
    // all: if the endpoint is broken, both fail identically.
    let { status, body } = await read();
    if (status !== 200) ({ status, body } = await read());

    expect(status, `the server answered ${status}: ${body}`).toBe(200);
    const processes = JSON.parse(body) as { pid: number; name: string; memoryKb: number }[];

    expect(processes.length).toBeGreaterThan(1);
    for (const process of processes) {
      expect(Number.isInteger(process.pid)).toBe(true);
      expect(process.pid).toBeGreaterThan(0);
      expect(process.name.length).toBeGreaterThan(0);
      expect(process.memoryKb).toBeGreaterThanOrEqual(0);
    }
    // The old table was this exact fixed set; a real list is never this.
    expect(processes.length).not.toBe(4);
    // Two reads at the server's 60 s budget each, plus the rest of the round trip.
  }, 300000);
});

describe('GET /api/tree', () => {
  it('walks the folders that are really there', async () => {
    const drives = (await (await fetch(server.url('/api/drives'))).json()) as { id: string; letter: string }[];
    const drive = drives.find((entry) => scratch.toUpperCase().startsWith(entry.letter.toUpperCase()));
    expect(drive, 'the scratch folder must live on a drive the server reports').toBeTruthy();

    const query = new URLSearchParams({ driveId: drive!.id, path: scratch, depth: '2' });
    const res = await fetch(server.url(`/api/tree?${query.toString()}`));
    expect(res.status).toBe(200);
    const tree = (await res.json()) as {
      path: string;
      entries: { name: string; depth: number }[];
      truncated: boolean;
    };

    expect(tree.path.toUpperCase()).toContain(scratch.split(path.sep).pop()!.toUpperCase());
    expect(tree.entries).toContainEqual({ name: 'alpha', depth: 1 });
    expect(tree.entries).toContainEqual({ name: 'gamma', depth: 1 });
    expect(tree.entries).toContainEqual({ name: 'beta', depth: 2 });
    expect(tree.truncated).toBe(false);
  });

  it('refuses a folder that does not exist instead of drawing an invented tree', async () => {
    const drives = (await (await fetch(server.url('/api/drives'))).json()) as { id: string; letter: string }[];
    const drive = drives.find((entry) => scratch.toUpperCase().startsWith(entry.letter.toUpperCase()))!;
    const query = new URLSearchParams({ driveId: drive.id, path: `${scratch}\\no-existe-${Date.now()}`, depth: '2' });

    const res = await fetch(server.url(`/api/tree?${query.toString()}`));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });
});
