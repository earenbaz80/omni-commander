// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * Tiles and media are loaded by <img> and <video>, which cannot send a header:
 * their per-launch token travels in the query. The packaged renderer runs from
 * file://, where Chromium reports `Origin: null` for those subresources, so the
 * origin gate has to accept the query token — while a write still has to prove
 * itself with the header. Otherwise every tile came back 403 and the map painted
 * black squares with an "offline" badge, even with a working connection.
 */
let server: TestServer;
const TOKEN = 'origin-test-token';

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: TOKEN } });
}, 40000);

afterAll(async () => {
  await server.stop();
});

const statusOf = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(server.url(path), init);
  return response.status;
};

describe('the origin gate', () => {
  it('lets the packaged renderer load a subresource with the token in the query', async () => {
    expect(await statusOf(`/api/maps/cache?t=${TOKEN}`, { headers: { Origin: 'null' } })).toBe(200);
  });

  it('refuses that subresource without the token', async () => {
    expect(await statusOf('/api/maps/cache', { headers: { Origin: 'null' } })).toBe(403);
  });

  it('refuses another origin even when it carries the token', async () => {
    expect(await statusOf(`/api/maps/cache?t=${TOKEN}`, { headers: { Origin: 'https://evil.example' } })).toBe(403);
  });

  it('accepts the app’s own dev origin', async () => {
    expect(await statusOf(`/api/maps/cache?t=${TOKEN}`, { headers: { Origin: 'http://localhost:3000' } })).toBe(200);
  });

  it('still demands the header for a write', async () => {
    const empty = JSON.stringify({});
    // A query token can load a picture; it cannot change the disk.
    expect(
      await statusOf(`/api/maps/offline?t=${TOKEN}`, {
        method: 'POST',
        headers: { Origin: 'null', 'Content-Type': 'application/json' },
        body: empty,
      }),
    ).toBe(403);

    // With the header it gets past the gate and is refused for its empty body,
    // which is the proof that the 403 above was about the token and not the body.
    expect(
      await statusOf('/api/maps/offline', {
        method: 'POST',
        headers: { Origin: 'null', 'Content-Type': 'application/json', 'x-omni-token': TOKEN },
        body: empty,
      }),
    ).toBe(400);
  });

  it('keeps an ordinary request with no origin working, which is what curl does', async () => {
    expect(await statusOf(`/api/maps/cache?t=${TOKEN}`)).toBe(200);
  });
});
