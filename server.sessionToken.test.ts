// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, WINDOWS_PROCESS_CASE_TIMEOUT_MS, type TestServer } from '@/scripts/serverHarness';

/**
 * `/api/tree` walks real folders to draw the panel: it exposes the same structure
 * as `/api/list`, so it belongs in the set of reads that must prove they hold the
 * per-launch token. It had been left out by oversight, which meant a client that
 * got past the origin rule could map the disk through the tree without the secret.
 *
 * The machine reads answer the same question about this computer — which
 * processes run, which addresses its cards hold, how loaded it is — so they are
 * held to the same proof rather than left open as "just status".
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

describe('el panel del motor', () => {
  // A browser opens the page by navigating, which cannot send a header, so the
  // token arrives in the URL. That proof covers the HTML and nothing else.
  it('se abre por navegación, con el token en la URL', async () => {
    expect(await statusOf('/__jobs')).toBe(403);
    expect(await statusOf(`/__jobs?t=${TOKEN}`)).toBe(200);
  });

  it('pero esa URL no lee los trabajos ni los ordena', async () => {
    expect(await statusOf(`/api/fs/jobs?t=${TOKEN}`)).toBe(403);
    expect(await statusOf(`/api/fs/dashboard?t=${TOKEN}`)).toBe(403);
    const pause = await fetch(server.url(`/api/fs/job/job-1/pause?t=${TOKEN}`), { method: 'POST' });
    expect(pause.status).toBe(403);
  });
});

describe('lecturas que describen la máquina', () => {
  const token = { headers: { 'x-omni-token': TOKEN } };

  it(
    'la tabla de procesos exige el token',
    async () => {
      expect(await statusOf('/api/processes')).toBe(403);
      expect(await statusOf('/api/processes', token)).toBe(200);
    },
    WINDOWS_PROCESS_CASE_TIMEOUT_MS,
  );

  it('las direcciones de red exigen el token', async () => {
    expect(await statusOf('/api/net/adapters')).toBe(403);
    expect(await statusOf('/api/net/adapters', token)).toBe(200);
  });

  it(
    'la carga del sistema exige el token',
    async () => {
      expect(await statusOf('/api/system/stats')).toBe(403);
      expect(await statusOf('/api/system/stats', token)).toBe(200);
    },
    WINDOWS_PROCESS_CASE_TIMEOUT_MS,
  );
});
