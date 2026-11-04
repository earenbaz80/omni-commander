// @vitest-environment node
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerArchiveRoutes } from './server/archiveReader.cjs';

/**
 * The archive routes moved out of `server.cjs`. Reading a real archive is covered
 * by the suite that boots the server with fixtures; what this module owns on its
 * own is the refusals — a request without an entry name, a path that does not
 * exist, and a file whose first bytes are not an archive — so those are what this
 * test pins, without needing a RAR on disk.
 */

const SAFE = /^[A-Za-z]:\\/;

const deps = {
  assertSafePath: (value: unknown) => {
    const candidate = String(value ?? '');
    if (!SAFE.test(candidate)) throw new Error(`Unsafe path: ${candidate}`);
    return candidate;
  },
};

let server: Server;
let origin = '';
let root = '';
let plainFile = '';

beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omni-archives-'));
  plainFile = path.join(root, 'no-es-un-archivo.txt');
  await fs.promises.writeFile(plainFile, 'esto no es un archivo comprimido');

  const app = express();
  app.use(express.json());
  registerArchiveRoutes(app, deps);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.promises.rm(root, { recursive: true, force: true });
});

const post = (route: string, body: unknown = {}) =>
  fetch(`${origin}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('rutas de archivos comprimidos', () => {
  it('exige el nombre de la entrada que se quiere leer', async () => {
    const response = await post('/api/archives/entry', { path: plainFile });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('entry is required');
  });

  it('dice que el fichero no está cuando no está', async () => {
    const response = await post('/api/archives/inspect', { path: path.join(root, 'fantasma.rar') });
    expect((await response.json()).code).toBe('not-found');
  });

  it('no trata un fichero cualquiera como un archivo comprimido', async () => {
    const response = await post('/api/archives/inspect', { path: plainFile });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(typeof payload.error).toBe('string');
    expect(payload.error.length).toBeGreaterThan(0);
  });

  it('rechaza una ruta que el servidor no acepta', async () => {
    const response = await post('/api/archives/inspect', { path: 'relativa.rar' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('not-found');
  });
});
