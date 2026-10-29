// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The free-space pre-flight decides whether a transfer can even start, so a
 * wrong number here either blocks a safe copy or lets an overflow through.
 * A move inside one volume is the case that matters most: it is a rename and
 * needs no room at all, yet its bytes would otherwise be counted as a copy.
 */
let server: TestServer;
let root = '';
let source = '';
let target = '';

const post = async (route: string, body: unknown) => {
  const res = await fetch(server.url(`/api/fs/${route}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-freespace-test-'));
  source = path.join(root, 'src');
  target = path.join(root, 'dst');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  // 7000 bytes total: a 5000-byte file plus a 2000-byte folder tree.
  fs.writeFileSync(path.join(source, 'grande.bin'), Buffer.alloc(5000, 1));
  fs.mkdirSync(path.join(source, 'arbol'));
  fs.writeFileSync(path.join(source, 'arbol', 'a.txt'), 'x'.repeat(2000));

  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
}, 30000);

afterAll(async () => {
  await server.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('POST /api/fs/freespace', () => {
  const sources = () => [path.join(source, 'grande.bin'), path.join(source, 'arbol')];

  it('measures a copy on the target volume', async () => {
    const { status, body } = await post('freespace', {
      plans: [{ targetDir: target, op: 'copy', sources: sources() }],
    });

    expect(status).toBe(200);
    expect(body.volumes).toHaveLength(1);
    expect(body.volumes[0].size).toBe(7000);
    expect(typeof body.volumes[0].free).toBe('number');
    expect(body.volumes[0].lacking).toBe(0);
    expect(body.volumes[0].complete).toBe(true);
  });

  it('counts nothing for a move inside the same volume', async () => {
    // Same volume as the target on purpose: this is a rename, not a write.
    const { body } = await post('freespace', {
      plans: [{ targetDir: target, op: 'move', sources: sources() }],
    });

    expect(body.volumes[0].size).toBe(0);
    expect(body.volumes[0].lacking).toBe(0);
  });

  it('adds only the writes when a copy and a same-volume move share a target', async () => {
    const { body } = await post('freespace', {
      plans: [
        { targetDir: target, op: 'copy', sources: [path.join(source, 'arbol')] },
        { targetDir: target, op: 'move', sources: sources() },
      ],
    });

    expect(body.volumes[0].size).toBe(2000);
  });

  it('rejects a body without a plan array', async () => {
    const { status } = await post('freespace', { plans: 'nope' });
    expect(status).toBe(400);
  });

  it('accepts a forced copy and lets the job finish', async () => {
    const started = await post('copy', {
      sources: [path.join(source, 'grande.bin')],
      targetDir: target,
      collision: 'overwrite',
      force: true,
    });
    expect(started.status).toBe(200);

    let status = 'running';
    for (let i = 0; i < 60 && status === 'running'; i++) {
      const job = await (await fetch(server.url(`/api/fs/job/${started.body.jobId}`))).json();
      status = (job as any).status;
      if (status === 'running') await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(status).toBe('done');
    expect(fs.statSync(path.join(target, 'grande.bin')).size).toBe(5000);
  });
});

/**
 * The pre-flight used to walk every source in the request, and a batch list can
 * carry far more than an answer should wait for. Past its budget it measures a
 * share and says so, because a size it did not finish measuring is a lower bound
 * and must not be shown as the total. These run against their own server: the
 * budget is read once at start-up.
 */
describe('POST /api/fs/freespace con presupuesto de fuentes', () => {
  let budgetServer: TestServer;
  let scratch = '';
  const fileA = () => path.join(scratch, 'a.bin');
  const fileB = () => path.join(scratch, 'b.bin');

  const ask = async (sources: string[]) => {
    const response = await fetch(budgetServer.url('/api/fs/freespace'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plans: [{ targetDir: scratch, op: 'copy', sources }] }),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-freespace-budget-'));
    fs.writeFileSync(fileA(), Buffer.alloc(3000, 2));
    fs.writeFileSync(fileB(), Buffer.alloc(2000, 3));

    // One source per request: the second one is always left unmeasured.
    budgetServer = await startServer({
      env: { OMNI_SESSION_TOKEN: '', OMNI_PREFLIGHT_SOURCE_BUDGET: '1' },
    });
  }, 30000);

  afterAll(async () => {
    await budgetServer.stop();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('mide lo que cabe en el presupuesto y marca el volumen como incompleto', async () => {
    const { status, body } = await ask([fileA(), fileB()]);

    expect(status).toBe(200);
    expect(body.volumes[0].complete).toBe(false);
    // The first source in order is the one measured; the second is a lower bound
    // that was left out, not a zero.
    expect(body.volumes[0].size).toBe(3000);
  });

  it('cobra cada repetición aunque recorra la fuente una sola vez', async () => {
    const { body } = await ask([fileA(), fileA()]);

    expect(body.volumes[0].complete).toBe(true);
    expect(body.volumes[0].size).toBe(6000);
  });
});
