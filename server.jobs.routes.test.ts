// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerJobRoutes } from './server/routes/jobs.cjs';

/**
 * The job routes moved out of `server.cjs`, so they are tested here against a
 * fake engine instead of a whole server: what this module owns is the answers,
 * not the work. The suites that run the real server still cover the rest.
 */

interface FakeJob {
  id: string;
  status: string;
  paused: boolean;
  cancelled: boolean;
  pendingConflict?: unknown;
  conflictOverride?: string;
  conflictDecision?: string;
  throttleBps?: number;
}

const job: FakeJob = { id: 'job-1', status: 'running', paused: false, cancelled: false };
const jobs = new Map<string, FakeJob>([['job-1', job]]);
const jobSnapshot = (entry: FakeJob) => ({
  id: entry.id,
  status: entry.status,
  paused: entry.paused,
  cancelled: entry.cancelled,
  throttleBps: entry.throttleBps ?? 0,
});

let server: Server;
let origin = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerJobRoutes(app, { jobs, jobSnapshot, preferredPort: 3001, getActivePort: () => 4321 });
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

describe('routes de trabajos', () => {
  it('lista los trabajos con su instantánea', async () => {
    const answer = await (await fetch(`${origin}/api/fs/jobs`)).json();
    expect(answer).toEqual([jobSnapshot(job)]);
  });

  it('informa del puerto que el servidor tiene de verdad, no del preferido', async () => {
    const answer = await (await fetch(`${origin}/api/fs/dashboard`)).json();
    expect(answer.port).toBe(4321);
    expect(answer.totalCount).toBe(1);
  });

  it('no inventa un trabajo que no existe', async () => {
    const response = await fetch(`${origin}/api/fs/job/fantasma`);
    expect(response.status).toBe(404);
  });

  it('pausa y reanuda el trabajo que sí existe', async () => {
    const paused = await (await fetch(`${origin}/api/fs/job/job-1/pause`, { method: 'POST' })).json();
    expect(paused.paused).toBe(true);
    const resumed = await (await fetch(`${origin}/api/fs/job/job-1/resume`, { method: 'POST' })).json();
    expect(resumed.paused).toBe(false);
  });

  it('rechaza una acción que no conoce', async () => {
    const response = await fetch(`${origin}/api/fs/job/job-1/bailar`, { method: 'POST' });
    expect(response.status).toBe(400);
  });

  it('guarda el límite de velocidad solo cuando es un número positivo', async () => {
    const answer = await (
      await fetch(`${origin}/api/fs/job/job-1/throttle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ throttleBps: 2048 }),
      })
    ).json();
    expect(answer.throttleBps).toBe(2048);
    const cleared = await (
      await fetch(`${origin}/api/fs/job/job-1/throttle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ throttleBps: -1 }),
      })
    ).json();
    expect(cleared.throttleBps).toBe(0);
  });
});
