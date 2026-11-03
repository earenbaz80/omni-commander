// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The map routes talk to OpenStreetMap, Nominatim and an IP locator, so these
 * tests only cover what the server must decide on its own: which requests it
 * refuses before any upstream call is made. That keeps the suite offline and
 * still pins the two regressions that matter — a malformed tile number reaching
 * the proxy, and a request without the per-launch token being answered at all.
 */
const TOKEN = 'maps-suite-token';
let server: TestServer;
/** Its own folder per run, so a saved tile from an earlier suite cannot answer. */
const CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-map-cache-'));

const get = async (route: string) => {
  const response = await fetch(server.url(route));
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { status: response.status, error: body.error };
};

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: TOKEN, OMNI_MAP_CACHE_DIR: CACHE_DIR } });
}, 40000);

afterAll(async () => {
  await server?.stop();
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

describe('map routes', () => {
  it('refuses a tile request that carries no token', async () => {
    const answer = await get('/api/maps/tile?layer=osm&z=5&x=15&y=12');
    expect(answer.status).toBe(403);
    expect(answer.error).toBe('Missing or invalid session token');
  });

  it('accepts the token in the query string, which is all an <img> can carry', async () => {
    const answer = await get(`/api/maps/tile?layer=nope&z=5&x=0&y=0&t=${TOKEN}`);
    expect(answer.status).toBe(400);
    expect(answer.error).toBe('invalid-tile');
  });

  it('rejects an unknown layer and impossible tile coordinates', async () => {
    expect((await get(`/api/maps/tile?layer=blueprint&z=5&x=0&y=0&t=${TOKEN}`)).status).toBe(400);
    expect((await get(`/api/maps/tile?layer=osm&z=40&x=0&y=0&t=${TOKEN}`)).status).toBe(400);
    // At zoom 2 the world has four tiles per axis, so x=9 does not exist.
    expect((await get(`/api/maps/tile?layer=osm&z=2&x=9&y=0&t=${TOKEN}`)).status).toBe(400);
    expect((await get(`/api/maps/tile?layer=osm&z=5&x=-1&y=0&t=${TOKEN}`)).status).toBe(400);
  });

  it('refuses a search without a token and a query that is too short', async () => {
    expect((await get('/api/maps/search?q=Madrid')).status).toBe(403);
    expect((await get(`/api/maps/search?q=a&t=${TOKEN}`)).status).toBe(400);
    expect((await get(`/api/maps/search?t=${TOKEN}`)).status).toBe(400);
  });

  it('protects the locating route the same way', async () => {
    expect((await get('/api/maps/locate')).status).toBe(403);
  });

  it('knows the extra OSM renders and refuses a made-up one', async () => {
    // A known layer is only rejected for its coordinates, an unknown one for
    // being unknown; both are 400s, so the error is what tells them apart.
    const post = async (body: unknown) => {
      const response = await fetch(server.url(`/api/maps/offline?t=${TOKEN}`), {
        method: 'POST',
        // Mutating routes want the token in the header; the query copy is only
        // there because an <img> cannot set one.
        headers: { 'Content-Type': 'application/json', 'x-omni-token': TOKEN },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json().catch(() => ({}))) as { error?: string } };
    };
    expect((await post({ layer: 'blueprint', tiles: [{ z: 5, x: 0, y: 0 }] })).body.error).toBe('invalid-layer');
    for (const layer of ['osm', 'humanitarian', 'cycle', 'topo', 'transport']) {
      expect((await post({ layer, tiles: [{ z: 40, x: 0, y: 0 }] })).body.error).toBe('invalid-tiles');
    }
  });

  it('refuses an offline save with no token and one with no tiles', async () => {
    const withoutToken = await fetch(server.url('/api/maps/offline'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'osm', tiles: [{ z: 5, x: 0, y: 0 }] }),
    });
    expect(withoutToken.status).toBe(403);

    const empty = await fetch(server.url(`/api/maps/offline?t=${TOKEN}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-omni-token': TOKEN },
      body: JSON.stringify({ layer: 'osm', tiles: [] }),
    });
    expect(empty.status).toBe(400);
  });

  // The point of the disk cache: a tile saved once is served with no upstream
  // call at all, which is what makes the map work on a train. The bytes here
  // are not a real PNG, so a test that reached the network could not pass it.
  it('serves a tile saved on disk without asking anyone upstream', async () => {
    const file = path.join(CACHE_DIR, 'osm', '5', '15', '12.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const saved = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    fs.writeFileSync(file, saved);

    const response = await fetch(server.url(`/api/maps/tile?layer=osm&z=5&x=15&y=12&t=${TOKEN}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer()).equals(saved)).toBe(true);
  });
});
