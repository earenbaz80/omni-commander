// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * GET /api/list answers a browser that is deciding where to point a pane, a
 * copy or the folder picker. "The folder is not there" is part of that
 * conversation, so it is a 404 with a plain message: a 500 used to make a
 * deleted destination look like a broken server, leak the raw ENOENT text with
 * the server's own path in it, and — because the client retries 5xx — cost two
 * pointless retries before the caller could react.
 *
 * The listing itself comes from whatever drive the scratch folder lives on, so
 * the drive id is derived instead of assumed.
 */
let server: TestServer;
let root = '';
let driveId = '';
let driveLetter = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const list = async (path_: string, drive = driveId) => {
  const response = await fetch(
    server.url(`/api/list?driveId=${encodeURIComponent(drive)}&path=${encodeURIComponent(path_)}`),
  );
  return { status: response.status, body: await response.json().catch(() => null) };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-list-'));
  fs.writeFileSync(path.join(root, 'informe.txt'), 'contenido');
  fs.mkdirSync(path.join(root, 'proyectos'));
  driveLetter = `${path.parse(root).root.charAt(0).toUpperCase()}:`;
  driveId = `real_${driveLetter.charAt(0)}`;

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

describe('GET /api/list', () => {
  it('lists a folder that exists, with its entries', async () => {
    const { status, body } = await list(root);

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((entry: { fullName: string }) => entry.fullName).sort()).toEqual(['informe.txt', 'proyectos']);
  });

  it('answers 404, not 500, for a folder that is not there', async () => {
    const missing = path.join(root, 'no-existe');
    const { status, body } = await list(missing);

    expect(status).toBe(404);
    expect(body.error).toContain('Folder not found');
    // The raw ENOENT text names the folder on the server's disk; a browser
    // asking about a destination has no business seeing it.
    expect(String(body.error)).not.toContain('ENOENT');
  });

  it('answers 404 for a file, which is not a folder to list', async () => {
    const { status, body } = await list(path.join(root, 'informe.txt'));

    expect(status).toBe(404);
    expect(body.error).toContain('Folder not found');
  });

  it('keeps refusing an unknown drive and a path outside it', async () => {
    const unknown = await list(root, 'real_ZZZ');
    const outside = await list(`${driveLetter}\\Windows`, 'real_ZZZ');

    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('Unknown drive');
    expect(outside.status).toBe(400);
  });

  it('still lists the drive root, which the panels address as a bare letter', async () => {
    const { status, body } = await list(driveLetter);

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});
