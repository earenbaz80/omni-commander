// @vitest-environment node
// Plain fetch and JSON: the DOM would only slow this down.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchShareStatus } from './shareStatus';

const { fetchWithRetry } = vi.hoisted(() => ({ fetchWithRetry: vi.fn() }));
vi.mock('../utils/fetchWithRetry', () => ({ fetchWithRetry }));

/** The answer the server sends for a running share. */
const answer = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
});

beforeEach(() => {
  fetchWithRetry.mockReset();
});

describe('fetchShareStatus', () => {
  it('answers the two facts the drawer shows, and copies nothing else', async () => {
    fetchWithRetry.mockResolvedValue(
      answer({
        active: true,
        port: 8787,
        // The full status carries these; the drawer has no use for them.
        folder: '/srv/out',
        token: 'secreto',
        startedAt: '2026-01-01T00:00:00.000Z',
        urls: ['http://192.168.1.10:8787/?t=secreto'],
      }),
    );

    await expect(fetchShareStatus()).resolves.toEqual({ active: true, port: 8787 });
  });

  it('answers null when the server says nothing about a running share', async () => {
    fetchWithRetry.mockResolvedValue(answer({ port: 8787 }));

    await expect(fetchShareStatus()).resolves.toBeNull();

    // A non-boolean is not an answer either: it must not read as "off".
    fetchWithRetry.mockResolvedValue(answer({ active: 'yes', port: 8787 }));

    await expect(fetchShareStatus()).resolves.toBeNull();
  });

  it('answers null when the server refuses the read', async () => {
    fetchWithRetry.mockResolvedValue(answer({ active: true, port: 8787 }, false));

    await expect(fetchShareStatus()).resolves.toBeNull();
  });

  it('answers null when the request never gets an answer', async () => {
    fetchWithRetry.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(fetchShareStatus()).resolves.toBeNull();
  });
});
