// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The origin guard is what keeps a third-party page from driving the loopback
 * filesystem API, so it has to refuse everything that is not the app itself —
 * and it has to keep accepting the app. Both halves are load-bearing, and the
 * second one broke silently: the guard compared the parsed hostname against a
 * bare `::1`, but WHATWG parsing keeps the brackets around an IPv6 literal, so
 * `http://[::1]:3000` never matched. A dev server that binds IPv6 loopback (this
 * one does) then answered 403 to every mutation.
 */
const ROUTE = '/api/fs/freespace';

let server: TestServer;

/**
 * Sends a deliberately malformed body through the guard. Node's `fetch` may
 * rewrite `Origin`, so the header is set on a raw request to test what the
 * server actually receives.
 *
 * The status separates the two outcomes: 403 means the guard refused, while 400
 * means the request got past it and the route rejected the body.
 */
const statusFor = (origin: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ plans: 'nope' });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: ROUTE,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Origin: origin,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });

beforeAll(async () => {
  // No session token: the other guard is not what this file is about.
  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
}, 30000);

afterAll(async () => {
  await server.stop();
});

describe('origin guard', () => {
  it('accepts the IPv6 form of loopback, brackets and all', async () => {
    expect(await statusFor('http://[::1]:3000')).toBe(400);
  });

  it('accepts localhost', async () => {
    expect(await statusFor('http://localhost:3000')).toBe(400);
  });

  it('accepts 127.0.0.1', async () => {
    expect(await statusFor('http://127.0.0.1:3000')).toBe(400);
  });

  it('refuses a third-party origin', async () => {
    expect(await statusFor('https://evil.example.com')).toBe(403);
  });
});
