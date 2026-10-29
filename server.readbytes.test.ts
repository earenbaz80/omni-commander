// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * POST /api/fs/read-bytes hands file content to the renderer, and the mistake
 * that used to cost the whole app was reading the wrong amount: a caller that
 * asked for "the file" without a preview cap got a multi-gigabyte ISO in memory.
 *
 * The route now has three intents, and this suite pins all three: a preview that
 * is truncated without complaining (the viewer asks for one byte more than it
 * shows, on purpose), a plain read that is refused with a 413 past the limit,
 * and an explicit `unlimited` read for the archive engine, which cannot parse an
 * archive it only half received.
 *
 * The limit is lowered to 1 KiB through OMNI_READ_BYTES_LIMIT so the boundary is
 * crossed with a 2 KiB file instead of a 64 MiB one.
 */
let server: TestServer;
let root = '';
let smallFile = '';
let largeFile = '';

const LIMIT = 1024;
const LARGE_SIZE = 2048;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ReadResult {
  status: number;
  bytes: Uint8Array;
  /** Parsed error payload, for the responses that carry one instead of content. */
  error?: { error?: string; size?: number; limit?: number };
}

const read = async (body: Record<string, unknown>): Promise<ReadResult> => {
  const response = await fetch(server.url('/api/fs/read-bytes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.ok) return { status: response.status, bytes };
  let error: ReadResult['error'];
  try {
    error = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    error = undefined;
  }
  return { status: response.status, bytes, error };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-readbytes-'));
  smallFile = path.join(root, 'nota.txt');
  fs.writeFileSync(smallFile, 'hola');
  largeFile = path.join(root, 'grande.bin');
  fs.writeFileSync(largeFile, 'a'.repeat(LARGE_SIZE));

  server = await startServer({
    env: { OMNI_SESSION_TOKEN: '', OMNI_READ_BYTES_LIMIT: String(LIMIT) },
  });
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

describe('POST /api/fs/read-bytes', () => {
  it('devuelve el archivo entero cuando cabe en el límite', async () => {
    const { status, bytes } = await read({ path: smallFile });

    expect(status).toBe(200);
    expect(new TextDecoder().decode(bytes)).toBe('hola');
  });

  it('se niega con 413 cuando el archivo no cabe y nadie pidió un tope', async () => {
    const { status, error } = await read({ path: largeFile });

    expect(status).toBe(413);
    expect(error?.size).toBe(LARGE_SIZE);
    expect(error?.limit).toBe(LIMIT);
    expect(String(error?.error)).toContain('too large');
  });

  it('lee el archivo entero cuando el llamante pide explícitamente todos los bytes', async () => {
    const { status, bytes } = await read({ path: largeFile, unlimited: true });

    expect(status).toBe(200);
    expect(bytes.length).toBe(LARGE_SIZE);
  });

  it('trunca una previsualización sin tratarla como un error', async () => {
    const { status, bytes } = await read({ path: largeFile, maxBytes: 10 });

    expect(status).toBe(200);
    expect(bytes.length).toBe(10);
  });

  it('no deja que un tope del cliente supere el límite del servidor', async () => {
    const { status, bytes } = await read({ path: largeFile, maxBytes: LARGE_SIZE * 10 });

    expect(status).toBe(200);
    expect(bytes.length).toBe(LIMIT);
  });

  it('solo acepta la lectura ilimitada como un sí explícito', async () => {
    const { status } = await read({ path: largeFile, unlimited: 'true' });

    expect(status).toBe(413);
  });
});
