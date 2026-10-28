// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The info drawer used to print invented CPU and RAM figures. These tests hold
 * the replacement to what the machine can actually be asked: a percentage
 * inside 0-100, one sample per logical core, and RAM that fits in the machine.
 */
let server: TestServer;

const getStats = async () => {
  const res = await fetch(server.url('/api/system/stats'));
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
}, 30000);

afterAll(async () => {
  await server.stop();
});

describe('GET /api/system/stats', () => {
  it('reports measured CPU load and memory of this machine', async () => {
    const { status, body } = await getStats();

    expect(status).toBe(200);
    expect(Number.isInteger(body.cores)).toBe(true);
    expect(body.cores).toBeGreaterThan(0);
    expect(typeof body.cpuPercent).toBe('number');
    expect(body.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(body.cpuPercent).toBeLessThanOrEqual(100);
    expect(body.ramTotalBytes).toBeGreaterThan(0);
    expect(body.ramTotalBytes).toBeLessThanOrEqual(os.totalmem());
    expect(body.ramUsedBytes).toBeGreaterThanOrEqual(0);
    expect(body.ramUsedBytes).toBeLessThanOrEqual(body.ramTotalBytes);
  });

  it('answers a second poll with a fresh percentage instead of nothing', async () => {
    const first = await getStats();
    const second = await getStats();

    // Two polls landing back to back share one sampling window; the server must
    // still answer with the last measurement rather than null.
    expect(typeof second.body.cpuPercent).toBe('number');
    expect(Number.isInteger(second.body.cores)).toBe(true);
    expect(second.body.ramTotalBytes).toBe(first.body.ramTotalBytes);
  });
});
