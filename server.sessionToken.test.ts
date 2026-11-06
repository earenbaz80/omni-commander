// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * `/api/tree` walks real folders to draw the panel: it exposes the same structure
 * as `/api/list`, so it belongs in the set of reads that must prove they hold the
 * per-launch token. It had been left out by oversight, which meant a client that
 * got past the origin rule could map the disk through the tree without the secret.
 */
let server: TestServer;
const TOKEN = 'sensitive-route-token';

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: TOKEN } });
}, 40000);

afterAll(async () => {
  await server.stop();
});

const statusOf = async (path: string, init: RequestInit = {}) => (await fetch(server.url(path), init)).status;

describe('lecturas que describen el disco', () => {
  it('el árbol exige el token, igual que el listado que dibuja lo mismo', async () => {
    expect(await statusOf('/api/tree?driveId=real_C&path=C:')).toBe(403);
  });

  it('con el token el árbol pasa la puerta', async () => {
    // 200 o el error del propio recorrido, nunca el 403 de la puerta.
    expect(await statusOf('/api/tree?driveId=real_C&path=C:', { headers: { 'x-omni-token': TOKEN } })).not.toBe(403);
  });

  it('las unidades siguen exigiéndolo', async () => {
    expect(await statusOf('/api/drives')).toBe(403);
    expect(await statusOf('/api/drives', { headers: { 'x-omni-token': TOKEN } })).toBe(200);
  });
});
