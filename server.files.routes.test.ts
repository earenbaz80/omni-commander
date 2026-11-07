// @vitest-environment node
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerFileRoutes } from './server/routes/files.cjs';

/**
 * The single-path file routes moved out of `server.cjs`. They run against a real
 * temporary folder here because what they promise is about the disk: a created
 * directory exists, a refused path is refused before it is touched, and a stat
 * answers with what the file actually is.
 */

const SAFE = /^[A-Za-z]:\\/;

const deps = {
  fs,
  path,
  express,
  assertSafePath: (value: unknown) => {
    const candidate = String(value ?? '');
    if (!SAFE.test(candidate)) throw new Error(`Unsafe path: ${candidate}`);
    return candidate;
  },
  assertArchiveDestination: async () => undefined,
  invalidateListings: () => undefined,
  pathExists: async (target: string) => fs.existsSync(target),
  assertFolder: async (value: string) => value,
  sendToFolder: async () => 'C:\\Users\\test\\Desktop',
  createShortcut: async () => undefined,
  copyIntoFolder: async (target: string, folder: string) => path.win32.join(folder, path.win32.basename(target)),
  uniqueName: async (_folder: string, name: string) => name,
};

let server: Server;
let origin = '';
let root = '';

beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omni-files-'));
  const app = express();
  app.use(express.json());
  registerFileRoutes(app, deps);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
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

describe('rutas de un solo fichero', () => {
  it('crea la carpeta que se le pide', async () => {
    const target = path.join(root, 'nueva');
    const answer = await (await post('/api/fs/mkdir', { path: target })).json();
    expect(answer).toEqual({ ok: true, path: target });
    expect(fs.existsSync(target)).toBe(true);
  });

  it('separa las carpetas que existen de las que no pudo comprobar', async () => {
    const real = path.join(root, 'nueva');
    const answer = await (
      await post('/api/fs/exists', { paths: [real, 'C:\\no-existe-omni', 'ruta-relativa'] })
    ).json();
    expect(answer.existing).toEqual([real]);
    expect(answer.unchecked).toEqual(['ruta-relativa']);
  });

  it('renombra y rechaza un nombre que Windows no admite', async () => {
    const source = path.join(root, 'nota.txt');
    await fs.promises.writeFile(source, 'hola');
    const invalid = await post('/api/fs/rename', { path: source, newName: 'a:b.txt' });
    expect(invalid.status).toBe(400);

    const renamed = await (await post('/api/fs/rename', { path: source, newName: 'otra.txt' })).json();
    expect(renamed.path).toBe(path.join(root, 'otra.txt'));
    expect(fs.existsSync(renamed.path)).toBe(true);
  });

  it('escribe el contenido que recibe', async () => {
    const target = path.join(root, 'escrito.txt');
    const answer = await (await post('/api/fs/write', { path: target, content: 'contenido' })).json();
    expect(answer.ok).toBe(true);
    expect(await fs.promises.readFile(target, 'utf8')).toBe('contenido');
  });

  it('mide un fichero y no un directorio', async () => {
    const file = path.join(root, 'escrito.txt');
    const answer = await (await post('/api/fs/stat', { paths: [file, root, 'ruta-relativa'] })).json();
    expect(answer.entries.map((entry: { name: string; isDirectory: boolean }) => entry.name)).toEqual([
      'escrito.txt',
      path.basename(root),
    ]);
    expect(answer.entries[0]).toMatchObject({ isDirectory: false, size: 'contenido'.length });
    expect(answer.entries[1]).toMatchObject({ isDirectory: true, size: 0 });
    expect(answer.missing).toHaveLength(1);
  });

  it('exige un array en stat', async () => {
    const response = await post('/api/fs/stat', { paths: 'no-es-un-array' });
    expect(response.status).toBe(400);
  });

  it('trunca una previsualización en vez de tratarla como un error', async () => {
    const target = path.join(root, 'largo.txt');
    await fs.promises.writeFile(target, 'x'.repeat(50));
    const response = await post('/api/fs/read-bytes', { path: target, maxBytes: 10 });
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it('no lee una ruta que el servidor no acepta', async () => {
    const response = await post('/api/fs/read-bytes', { path: 'relativa.txt', maxBytes: 10 });
    expect(response.status).toBe(400);
  });

  /**
   * The extraction's conflict prompt answers through this flag. What it must not
   * do is relax the guard for anyone else, or leave the temporary file the write
   * goes through behind when it succeeds.
   */
  it('reemplaza con overwrite y no deja temporales junto al fichero', async () => {
    const folder = path.join(root, 'sobrescritura');
    await fs.promises.mkdir(folder, { recursive: true });
    const target = path.join(folder, 'dato.bin');
    const write = (body: string, overwrite: boolean) =>
      fetch(
        `${origin}/api/fs/write-bytes?path=${encodeURIComponent(target)}&root=${encodeURIComponent(folder)}${overwrite ? '&overwrite=1' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        },
      );

    expect((await write('primero', false)).status).toBe(200);
    // Without the flag the route still refuses a name that is already there.
    expect((await write('segundo', false)).status).toBe(400);
    expect(await fs.promises.readFile(target, 'utf8')).toBe('primero');

    expect((await write('segundo', true)).status).toBe(200);
    expect(await fs.promises.readFile(target, 'utf8')).toBe('segundo');
    // The replacement is written under a temporary name first, so the folder
    // must hold the file and nothing else once the answer came back.
    expect((await fs.promises.readdir(folder)).sort()).toEqual(['dato.bin']);

    // A directory on the destination makes the rename fail after the temporary
    // has been written: that is where a missing cleanup would show up, and a
    // plain truncating write would never take this path at all.
    const asFolder = path.join(folder, 'ocupado');
    await fs.promises.mkdir(asFolder);
    const refused = await fetch(
      `${origin}/api/fs/write-bytes?path=${encodeURIComponent(asFolder)}&root=${encodeURIComponent(folder)}&overwrite=1`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'nada' },
    );
    expect(refused.status).toBe(400);
    expect((await fs.promises.readdir(folder)).sort()).toEqual(['dato.bin', 'ocupado']);
  });
});
