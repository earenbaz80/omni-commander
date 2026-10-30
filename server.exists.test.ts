// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * POST /api/fs/exists is how the folder tree decides that a pinned folder was
 * deleted outside the app. Two answers matter as much as the positive one: a
 * file is not a folder to pin, and a path the server refuses to judge must come
 * back as `unchecked` rather than silently missing, or the caller would forget
 * a favourite over a permissions problem.
 */
let server: TestServer;
let root = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const post = async (paths: unknown) => {
  const response = await fetch(server.url('/api/fs/exists'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-exists-'));
  fs.mkdirSync(path.join(root, 'viva'));
  fs.writeFileSync(path.join(root, 'nota.txt'), 'contenido');
  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
}, 40000);

afterAll(async () => {
  await server.stop();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* still closing */
    }
    if (!fs.existsSync(root)) return;
    await sleep(150);
  }
}, 20000);

describe('POST /api/fs/exists', () => {
  it('answers only the folders that are still on disk', async () => {
    const folder = path.join(root, 'viva');
    const { status, body } = await post([folder, path.join(root, 'borrada')]);

    expect(status).toBe(200);
    expect(body.existing).toEqual([folder]);
    expect(body.unchecked).toEqual([]);
  });

  it('does not treat a file as a folder to pin', async () => {
    const { body } = await post([path.join(root, 'nota.txt')]);

    expect(body.existing).toEqual([]);
  });

  it('reports a path it refuses to judge instead of calling it deleted', async () => {
    const relative = 'no-es-absoluta';
    const { status, body } = await post([relative]);

    expect(status).toBe(200);
    expect(body.existing).toEqual([]);
    expect(body.unchecked).toEqual([relative]);
  });

  it('answers an empty request without inventing entries', async () => {
    const { body } = await post([]);

    expect(body).toEqual({ existing: [], unchecked: [] });
  });
});
