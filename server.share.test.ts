// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * The network share is a second listener that hands a whole folder to anyone who
 * has its link. What is worth pinning down is its narrow surface: the token is
 * required, the listing and a file are all it serves, and a path that climbs out
 * of the shared folder is refused before the disk is touched.
 */
const require = createRequire(import.meta.url);

interface ShareStatus {
  active: boolean;
  folder: string | null;
  port: number | null;
  token: string | null;
  urls: string[];
}

interface ShareService {
  start(options?: { folder?: string; port?: number }): Promise<ShareStatus>;
  stop(): void;
  status(): ShareStatus;
}

const { createShareService } = require('./server/share.cjs') as {
  createShareService: (options?: { logDebug?: (...args: unknown[]) => void }) => ShareService;
};

const windowsOnly = describe.skipIf(process.platform !== 'win32');

let root: string;
let shared: string;
let service: ShareService;
let status: ShareStatus;

const url = (relativePath: string, token = status?.token) =>
  `http://127.0.0.1:${status.port}/s/${token}?p=${encodeURIComponent(relativePath)}`;

windowsOnly('the network share', () => {
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-share-'));
    shared = path.join(root, 'shared');
    fs.mkdirSync(path.join(shared, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'inside.txt'), 'hola desde la carpeta compartida');
    fs.writeFileSync(path.join(shared, 'sub', 'inner.txt'), 'nested file');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'no deberia verse');

    service = createShareService();
    // Port 0 asks the OS for a free one, so the suite never fights a real share.
    status = await service.start({ folder: shared, port: 0 });
  }, 30000);

  afterAll(() => {
    service?.stop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a port, a token and the folder it is serving', () => {
    expect(status.active).toBe(true);
    expect(status.port).toBeGreaterThan(0);
    expect(status.token).toMatch(/^[0-9a-f]{32}$/);
    expect(service.status().folder).toBe(path.win32.normalize(shared));
  });

  it('lists the shared folder', async () => {
    const response = await fetch(url(''));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('inside.txt');
    expect(body).toContain('sub');
    expect(body).not.toContain('outside.txt');
  });

  it('downloads a file and a nested one', async () => {
    const top = await fetch(url('inside.txt'));
    expect(top.status).toBe(200);
    expect(await top.text()).toBe('hola desde la carpeta compartida');
    expect(top.headers.get('content-disposition')).toBeNull();

    const nested = await fetch(url('sub/inner.txt'));
    expect(nested.status).toBe(200);
    expect(await nested.text()).toBe('nested file');
  });

  it('serves nothing without the token', async () => {
    const response = await fetch(url('inside.txt', 'f'.repeat(32)));
    expect(response.status).toBe(404);
    const wrong = await fetch(`http://127.0.0.1:${status.port}/s/short?p=`);
    expect(wrong.status).toBe(404);
  });

  it('refuses a path that climbs out of the shared folder', async () => {
    expect((await fetch(url('../outside.txt'))).status).toBe(403);
    expect((await fetch(url('sub/../../outside.txt'))).status).toBe(403);
    expect((await fetch(url(path.join(root, 'outside.txt')))).status).toBe(403);
  });

  it('stops serving once the share is stopped', async () => {
    const address = url('inside.txt');
    service.stop();
    expect(service.status().active).toBe(false);
    await expect(fetch(address)).rejects.toThrow();
  });
});
