// @vitest-environment node
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerArchiveRoutes } from './server/archiveReader.cjs';
import { extractZipEntryTo } from './server/zipStream.cjs';

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
  // The same rule the real guard applies, without its symlink walk: only paths
  // inside the declared folder may be written.
  assertArchiveDestination: async (rootValue: unknown, target: unknown) => {
    const relative = path.win32.relative(String(rootValue ?? ''), String(target ?? ''));
    if (!relative || relative === '..' || relative.startsWith('..\\') || path.win32.isAbsolute(relative))
      throw new Error('Invalid destination');
  },
};

let server: Server;
let origin = '';
let root = '';
let plainFile = '';
let zipFile = '';
/** 192 MB of zeros: it compresses to almost nothing and takes long enough to
 *  pause in the middle of the write. */
const bigSize = 192 * 1024 * 1024;
let bigZipFile = '';
let tarFile = '';
/** 2 MB of a repeating byte: big enough to need several chunks through a socket. */
const bigBytes = Uint8Array.from({ length: 2 * 1024 * 1024 }, (_, index) => index % 251);

/**
 * A POSIX TAR built here rather than with an external tool, so the suite does
 * not depend on `tar.exe` being on the machine. The `ustar` magic lives at byte
 * 257, which is the whole reason a plain `.tar` needs its own signature check.
 */
function tarHeader(name: string, size: number, mtime: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'latin1'); // mode
  header.write('0000000\0', 108, 'latin1'); // uid
  header.write('0000000\0', 116, 'latin1'); // gid
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  header.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136, 'latin1');
  header.fill(0x20, 148, 156); // checksum counts as spaces until it is written
  header.write('0', 156, 'latin1'); // regular file
  header.write('ustar\0', 257, 'latin1');
  header.write('00', 263, 'latin1');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return header;
}

function tarWith(name: string, content: string): Buffer {
  const bytes = Buffer.from(content, 'utf8');
  const body = Buffer.alloc(Math.ceil(bytes.length / 512) * 512);
  bytes.copy(body);
  return Buffer.concat([tarHeader(name, bytes.length, 1_767_225_600), body, Buffer.alloc(1024)]);
}

beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omni-archives-'));
  plainFile = path.join(root, 'no-es-un-archivo.txt');
  await fs.promises.writeFile(plainFile, 'esto no es un archivo comprimido');

  zipFile = path.join(root, 'muestra.zip');
  const zip = new JSZip();
  zip.file('grande.bin', bigBytes);
  zip.file('nota.txt', 'hola');
  await fs.promises.writeFile(zipFile, await zip.generateAsync({ type: 'nodebuffer' }));

  bigZipFile = path.join(root, 'enorme.zip');
  const bigZip = new JSZip();
  bigZip.file('enorme.bin', new Uint8Array(bigSize));
  await fs.promises.writeFile(bigZipFile, await bigZip.generateAsync({ type: 'nodebuffer' }));

  tarFile = path.join(root, 'muestra.tar');
  await fs.promises.writeFile(tarFile, tarWith('nota.txt', 'hola desde el tar'));

  const app = express();
  app.use(express.json());
  registerArchiveRoutes(app, deps);
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

  it('abre un TAR sin comprimir y lista su contenido', async () => {
    const response = await post('/api/archives/inspect', { path: tarFile });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { entries: { name: string; size: number }[] };
    expect(payload.entries.map((entry) => entry.name)).toContain('nota.txt');
  });

  it('rechaza una ruta que el servidor no acepta', async () => {
    const response = await post('/api/archives/inspect', { path: 'relativa.rar' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('not-found');
  });
});

describe('extraer una entrada a disco', () => {
  const output = () => path.join(root, 'extraido');

  it('escribe la entrada exacta y no deja restos temporales', async () => {
    const destination = path.join(output(), 'carpeta', 'grande.bin');
    const response = await post('/api/archives/extract', {
      path: zipFile,
      entry: 'grande.bin',
      target: destination,
      root: output(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    // One line of JSON per update, the last of which says what landed.
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; bytes?: number });
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true, bytes: bigBytes.length });
    expect(events.every((event) => event.type === 'progress' || event.type === 'done')).toBe(true);
    expect((await fs.promises.readFile(destination)).equals(Buffer.from(bigBytes))).toBe(true);
    expect((await fs.promises.readdir(path.dirname(destination))).filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('extrae una entrada de un TAR sin comprimir', async () => {
    const destination = path.join(output(), 'tar', 'nota.txt');
    const response = await post('/api/archives/extract', {
      path: tarFile,
      entry: 'nota.txt',
      target: destination,
      root: output(),
    });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; ok?: boolean; bytes?: number });
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true, bytes: 17 });
    expect(await fs.promises.readFile(destination, 'utf8')).toBe('hola desde el tar');
  });

  it('se niega a pisar un archivo que ya existe', async () => {
    const destination = path.join(output(), 'repetido.bin');
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, 'lo que ya habia');
    const response = await post('/api/archives/extract', {
      path: zipFile,
      entry: 'grande.bin',
      target: destination,
      root: output(),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('exists');
    expect(await fs.promises.readFile(destination, 'utf8')).toBe('lo que ya habia');
  });

  it('reemplaza el archivo existente cuando la respuesta del aviso lo pide', async () => {
    const destination = path.join(output(), 'reemplazado.bin');
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, 'lo que ya habia');
    const response = await post('/api/archives/extract', {
      path: zipFile,
      entry: 'grande.bin',
      target: destination,
      root: output(),
      overwrite: true,
    });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; ok?: boolean });
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true });
    expect(await fs.promises.readFile(destination, 'utf8')).not.toBe('lo que ya habia');
  });

  it('no escribe fuera de la carpeta declarada', async () => {
    const response = await post('/api/archives/extract', {
      path: zipFile,
      entry: 'grande.bin',
      target: path.join(os.tmpdir(), 'omni-fuera.bin'),
      root: output(),
    });
    expect(response.status).toBe(400);
    await expect(fs.promises.stat(path.join(os.tmpdir(), 'omni-fuera.bin'))).rejects.toThrow();
  });

  it('dice que la entrada no está cuando el nombre no existe', async () => {
    const response = await post('/api/archives/extract', {
      path: zipFile,
      entry: 'no-existe.bin',
      target: path.join(output(), 'no-existe.bin'),
      root: output(),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('entry-not-found');
  });

  it('detiene la escritura al pausar y la continúa al reanudar', async () => {
    const folder = path.join(root, 'pausado');
    await fs.promises.mkdir(folder, { recursive: true });
    const destination = path.join(folder, 'enorme.bin');
    const job = 'job-pausa';
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/archives/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: bigZipFile, entry: 'enorme.bin', target: destination, root: folder, job }),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    // The first line means the write is already under way.
    await reader.read();
    expect((await post('/api/archives/extract/pause', { job })).status).toBe(200);

    const partSize = async () => {
      const part = (await fs.promises.readdir(folder)).find((name) => name.endsWith('.part'));
      return part ? (await fs.promises.stat(path.join(folder, part))).size : -1;
    };
    await new Promise((resolve) => setTimeout(resolve, 250));
    const paused = await partSize();
    // The write has to be visible as a temporary file: a run that already
    // finished would make the pause look like it worked when it never applied.
    expect(paused).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await partSize()).toBe(paused);

    expect((await post('/api/archives/extract/resume', { job })).status).toBe(200);
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const last = JSON.parse(text.trim().split('\n').at(-1)!) as { type: string; bytes?: number };
    expect(last).toMatchObject({ type: 'done', bytes: bigSize });
    expect((await fs.promises.stat(destination)).size).toBe(bigSize);
    expect((await fs.promises.readdir(folder)).filter((name) => name.endsWith('.part'))).toEqual([]);
  }, 60000);

  it('dice que no hay tal extracción cuando el id no existe', async () => {
    expect((await post('/api/archives/extract/pause', { job: 'fantasma' })).status).toBe(404);
    expect((await post('/api/archives/extract/resume', { job: 'fantasma' })).status).toBe(404);
  });

  it('no publica nada cuando la extracción se cancela', async () => {
    const folder = path.join(root, 'cancelado');
    await fs.promises.mkdir(folder, { recursive: true });
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractZipEntryTo(zipFile, 'grande.bin', path.join(folder, 'grande.bin'), undefined, controller.signal),
    ).rejects.toThrow();
    // The temporary file is a sibling of the destination: neither may survive.
    expect(await fs.promises.readdir(folder)).toEqual([]);
  });
});
