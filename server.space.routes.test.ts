// @vitest-environment node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerSpaceRoutes } from './server/routes/space.cjs';
import { assertSafePath } from './server/pathSafety.cjs';

/**
 * The routes a transfer asks before it starts. They moved out of `server.cjs`
 * together, so they are described together: one volume question, one file
 * question, one list on disk.
 *
 * The tree walker is stubbed here on purpose -- what this module owns is the
 * arithmetic around it (which sources are charged to which volume, which ones the
 * budget left unmeasured) and the bytes it writes, not the walk. The walk itself,
 * against real folders, is `server.freespace.test.ts`.
 */

const measured: string[] = [];
const deps = {
  fs,
  path,
  os,
  crypto,
  assertSafePath,
  measureTree: async (target: string) => {
    measured.push(target);
    return { bytes: 1000 + target.length };
  },
  logDebug: () => undefined,
};

const app = express();
app.use(express.json());
registerSpaceRoutes(app, deps);

let server: Server;
let origin = '';
let root = '';

const post = async (route: string, body: unknown) => {
  const response = await fetch(`${origin}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-space-'));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('POST /api/fs/freespace', () => {
  it('charges each source to the volume it is written to and reports the free space', async () => {
    const source = path.join(root, 'origen.txt');
    fs.writeFileSync(source, 'x');
    const { status, body } = await post('/api/fs/freespace', {
      plans: [{ targetDir: root, sources: [source], op: 'copy' }],
    });

    expect(status).toBe(200);
    expect(body.volumes).toHaveLength(1);
    expect(body.volumes[0].size).toBe(1000 + source.length);
    expect(body.volumes[0].complete).toBe(true);
    expect(typeof body.volumes[0].free).toBe('number');
    expect(body.volumes[0].lacking).toBe(0);
  });

  it('walks a source listed twice once but charges it twice', async () => {
    const source = path.join(root, 'repetido.txt');
    const { body } = await post('/api/fs/freespace', {
      plans: [
        { targetDir: root, sources: [source, source], op: 'copy' },
        { targetDir: root, sources: [source], op: 'copy' },
      ],
    });

    expect(body.volumes[0].size).toBe(3 * (1000 + source.length));
    expect(measured.filter((entry) => entry === source)).toHaveLength(1);
  });

  it('counts nothing for a move inside one volume, because it is a rename', async () => {
    const source = path.join(root, 'mueve.txt');
    const { body } = await post('/api/fs/freespace', {
      plans: [{ targetDir: root, sources: [source], op: 'move' }],
    });

    expect(body.volumes[0].size).toBe(0);
  });

  it('refuses a plan that is not a list of paths it may touch', async () => {
    expect((await post('/api/fs/freespace', { plans: 'no' })).status).toBe(400);
    expect(
      (await post('/api/fs/freespace', { plans: [{ targetDir: 'C:\\a', sources: ['\\\\host\\share'] }] })).status,
    ).toBe(400);
  });
});

describe('GET /api/fs/hash', () => {
  it('hashes the bytes of the file, not its metadata', async () => {
    const file = path.join(root, 'datos.bin');
    fs.writeFileSync(file, 'contenido real');
    const response = await fetch(`${origin}/api/fs/hash?path=${encodeURIComponent(file)}`);
    const body = (await response.json()) as any;
    const expected = crypto.createHash('md5').update('contenido real').digest('hex');

    expect(response.status).toBe(200);
    expect(body.md5).toBe(expected);
    expect(body.size).toBe(Buffer.byteLength('contenido real'));
    expect(body.sha256).toHaveLength(64);
  });

  it('answers 400 for a directory and 404 for a file that is not there', async () => {
    expect((await fetch(`${origin}/api/fs/hash?path=${encodeURIComponent(root)}`)).status).toBe(400);
    expect((await fetch(`${origin}/api/fs/hash?path=${encodeURIComponent(path.join(root, 'no-existe'))}`)).status).toBe(
      404,
    );
  });
});

describe('the copy list on disk', () => {
  const listPath = () => path.join(root, 'listas', 'copia.json');

  it('saves a batch and reads it back in a later request', async () => {
    const saved = await post('/api/fs/copylist/save', {
      path: listPath(),
      list: [{ sources: ['C:\\a'], targetDir: 'C:\\b' }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(1);

    const loaded = await post('/api/fs/copylist/load', { path: listPath() });
    expect(loaded.body.found).toBe(true);
    expect(loaded.body.list).toEqual([{ sources: ['C:\\a'], targetDir: 'C:\\b' }]);
  });

  it('answers an empty list, not an error, when the file has never been written', async () => {
    const loaded = await post('/api/fs/copylist/load', { path: path.join(root, 'listas', 'no.json') });
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual({ ok: true, path: path.join(root, 'listas', 'no.json'), list: [], found: false });
  });

  it('refuses a file that is not a transfer list instead of guessing', async () => {
    const broken = path.join(root, 'roto.json');
    fs.writeFileSync(broken, '{ no es json');
    expect((await post('/api/fs/copylist/load', { path: broken })).status).toBe(400);

    const empty = path.join(root, 'sin-lista.json');
    fs.writeFileSync(empty, JSON.stringify({ version: 1 }));
    expect((await post('/api/fs/copylist/load', { path: empty })).status).toBe(400);
  });
});
