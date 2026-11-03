// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const get = async (route: string) => {
  const response = await fetch(server.url(route));
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { status: response.status, error: body.error };
};

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: TOKEN } });
}, 40000);

afterAll(async () => {
  await server?.stop();
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
});
