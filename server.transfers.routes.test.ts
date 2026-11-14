// @vitest-environment node
import express from 'express';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerTransferRoutes } from './server/routes/transfers.cjs';

/**
 * The transfer and cleanup routes moved out of `server.cjs`; the queue they drive
 * stayed behind. What this module owns is the HTTP surface -- what is refused
 * before a job exists, and what the cleanup report contains -- so it is tested
 * against fakes that record what the routes asked them to do. The suites that
 * boot the real server still cover the work itself.
 */

const rejected: string[] = [];
const started: Array<Record<string, unknown>> = [];

const deps = {
  fs,
  assertSafePath: (value: unknown) => String(value ?? ''),
  makeJob: (op: string, label: string) => ({ id: 'job-1', op, label, itemsTotal: 0, itemsDone: 0, errors: [] }),
  startJob: (job: Record<string, unknown>) => started.push(job),
  waitWhilePaused: async () => undefined,
  runTransferJob: async () => undefined,
  noteFile: (_job: unknown, target: string, size: number) => ({ path: target, size, copied: 0, status: 'pending' }),
  deleteTarget: async () => undefined,
  invalidateListings: () => undefined,
  logRejected: (route: string) => {
    rejected.push(route);
  },
  CLEANUP_TARGETS: { 'user-temp': { requiresAdmin: false } },
  cleanupTargetPath: () => 'C:\\Temp',
  resolveCleanupRoot: (targetId: string) => `C:\\cleanup\\${targetId}`,
  clampCleanupDays: (value: unknown) => Number(value) || 30,
  scanCleanup: async () => ({
    files: [
      { name: 'viejo.tmp', size: 10, modifiedMs: 0 },
      { name: 'otro.tmp', size: 40, modifiedMs: 0 },
    ],
    dirs: [],
    bytes: 50,
    skipped: 0,
    truncated: false,
  }),
  runCleanup: async () => ({ removed: 2, bytes: 50 }),
};

let server: Server;
let origin = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerTransferRoutes(app, deps);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (route: string, body: unknown = {}) =>
  fetch(`${origin}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('rutas de transferencia', () => {
  it('no arranca una copia sin fuentes y deja rastro del rechazo', async () => {
    const response = await post('/api/fs/copy', { targetDir: 'C:\\destino' });
    expect(response.status).toBe(400);
    expect(rejected).toContain('/api/fs/copy');
  });

  it('no arranca un borrado sin objetivos', async () => {
    const response = await post('/api/fs/delete', { targets: [] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('No targets provided');
  });

  it('no borra la raíz de una unidad, ni siquiera sin papelera', async () => {
    const response = await post('/api/fs/delete', { targets: ['C:\\'], useTrash: false });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/drive root/i);
  });

  it('marca el trabajo como continuación cuando la repetición lo pide', async () => {
    const response = await post('/api/fs/copy', {
      sources: ['C:\\origen\\a.txt'],
      targetDir: os.tmpdir(),
      resume: true,
    });

    expect(response.status).toBe(200);
    // The engine only skips what the earlier run copied when the job says so.
    expect(started.at(-1)?.resumeExisting).toBe(true);
  });

  it('sigue borrando una carpeta normal', async () => {
    const response = await post('/api/fs/delete', { targets: ['C:\\temp\\viejo'] });
    expect(response.status).toBe(200);
    expect((await response.json()).jobId).toBe('job-1');
  });

  it('no mueve la raíz de una unidad', async () => {
    const response = await post('/api/fs/move', { sources: ['D:/'], targetDir: 'C:\\destino' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/drive root/i);
  });
});

describe('rutas de limpieza', () => {
  it('anuncia las carpetas que el menú puede ofrecer', async () => {
    const answer = await (await post('/api/fs/cleanup/targets')).json();
    expect(answer.targets).toEqual([
      { id: 'user-temp', path: 'C:\\Temp', requiresAdmin: false, exists: fs.existsSync('C:\\Temp') },
    ]);
  });

  it('resume el escaneo con los números medidos y los mayores por tamaño', async () => {
    const answer = await (await post('/api/fs/cleanup/scan', { target: 'user-temp', minAgeDays: '7' })).json();
    expect(answer.path).toBe('C:\\cleanup\\user-temp');
    expect(answer.minAgeDays).toBe(7);
    expect(answer.files).toBe(2);
    expect(answer.bytes).toBe(50);
    expect(answer.largest.map((file: { name: string }) => file.name)).toEqual(['otro.tmp', 'viejo.tmp']);
  });
});
