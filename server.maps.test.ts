// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMapRoutes } from './server/routes/maps.cjs';

/**
 * The cache the map fills lives on disk, so the state route and the clear route
 * are only worth testing against a real folder: a mock would answer whatever it
 * was told, including the count the bug is about.
 */

type Handler = (req: Record<string, unknown>, res: unknown) => unknown;

function buildApp() {
  const routes = new Map<string, Handler>();
  const record = (method: string) => (routePath: string, handler: Handler) => {
    routes.set(`${method} ${routePath}`, handler);
  };
  registerMapRoutes({ get: record('GET'), post: record('POST'), delete: record('DELETE') } as never, {
    SESSION_TOKEN: '',
    parseByteRange: () => null,
    MEDIA_TYPES: new Map<string, string>(),
    assertSafePath: (value: string) => value,
    logDebug: () => {},
  });
  return routes;
}

async function call(
  routes: Map<string, Handler>,
  key: string,
  request: { query?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  const captured = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
    setHeader() {
      return res;
    },
    send() {
      return res;
    },
  };
  const handler = routes.get(key);
  if (!handler) throw new Error(`${key} is not registered`);
  await handler({ query: request.query ?? {}, headers: request.headers ?? {} }, res);
  return captured;
}

/** A cache folder with two tiles of known size, in two layers. */
function seedCache(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-map-cache-'));
  fs.mkdirSync(path.join(dir, 'osm', '5', '10'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'osm', '5', '10', '12.png'), Buffer.alloc(10));
  fs.mkdirSync(path.join(dir, 'topo', '6', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'topo', '6', '1', '2.png'), Buffer.alloc(5));
  // Anything that is not a tile is left alone: the folder can pick up a stray
  // file and the count must not include it.
  fs.writeFileSync(path.join(dir, 'osm', 'notes.txt'), 'not a tile');
  process.env.OMNI_MAP_CACHE_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.OMNI_MAP_CACHE_DIR;
});

describe('the map cache routes', () => {
  it('reports how many tiles are kept and how much they weigh', async () => {
    seedCache();
    const { status, body } = await call(buildApp(), 'GET /api/maps/cache');

    expect(status).toBe(200);
    expect(body).toMatchObject({ tiles: 2, bytes: 15, layers: { osm: 1, topo: 1 } });
  });

  it('answers an empty cache instead of failing when the folder is missing', async () => {
    process.env.OMNI_MAP_CACHE_DIR = path.join(os.tmpdir(), 'omni-map-cache-does-not-exist');
    const { status, body } = await call(buildApp(), 'GET /api/maps/cache');

    expect(status).toBe(200);
    expect(body).toMatchObject({ tiles: 0, bytes: 0 });
  });

  it('empties the folder and says what it removed', async () => {
    const dir = seedCache();
    const { status, body } = await call(buildApp(), 'DELETE /api/maps/cache');

    expect(status).toBe(200);
    expect(body).toMatchObject({ removed: 2, bytes: 15 });
    // The whole tree goes, not just the files: an empty layer folder would grow
    // back with the next download and the next clear would have to guess.
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('refuses to clear when the session token does not match', async () => {
    const dir = seedCache();
    const routes = new Map<string, Handler>();
    const record = (method: string) => (routePath: string, handler: Handler) => {
      routes.set(`${method} ${routePath}`, handler);
    };
    registerMapRoutes({ get: record('GET'), post: record('POST'), delete: record('DELETE') } as never, {
      SESSION_TOKEN: 'secret',
      parseByteRange: () => null,
      MEDIA_TYPES: new Map<string, string>(),
      assertSafePath: (value: string) => value,
      logDebug: () => {},
    });

    const refused = await call(routes, 'DELETE /api/maps/cache');
    expect(refused.status).toBe(403);
    expect(fs.existsSync(path.join(dir, 'osm', '5', '10', '12.png'))).toBe(true);

    // A fetch can carry the token in the header, which is why this route takes
    // both: a tile is loaded by an <img> and cannot.
    const allowed = await call(routes, 'DELETE /api/maps/cache', { headers: { 'x-omni-token': 'secret' } });
    expect(allowed.status).toBe(200);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
