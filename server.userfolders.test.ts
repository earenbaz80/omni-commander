// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * GET /api/user-folders feeds the "Quick Access" section of the folder tree.
 * Desktop and Documents are commonly redirected into OneDrive, so the answer has
 * to come from the profile Windows actually uses rather than from a guess at
 * %USERPROFILE%; whatever comes back must be a folder this machine has, or the
 * tree would offer a path that fails to open.
 */
let server: TestServer;

beforeAll(async () => {
  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
}, 40000);

afterAll(async () => {
  await server.stop();
}, 20000);

const fetchFolders = async () => {
  const response = await fetch(server.url('/api/user-folders'));
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
};

describe('GET /api/user-folders', () => {
  it('answers the five Windows libraries that exist on this machine', async () => {
    const { status, body } = await fetchFolders();

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const keys = body.map((entry: { key: string }) => entry.key);
    expect(keys).toContain('desktop');
    expect(keys).toContain('documents');
    // Only the ids the renderer knows how to label.
    const known = ['desktop', 'documents', 'pictures', 'music', 'videos'];
    expect(keys.every((key: string) => known.includes(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reports absolute folders that are really there', async () => {
    const { body } = await fetchFolders();

    expect(body.length).toBeGreaterThan(0);
    for (const entry of body as { key: string; path: string }[]) {
      expect(entry.path).toMatch(/^[A-Za-z]:\\/);
      expect(fs.statSync(entry.path).isDirectory()).toBe(true);
    }
  });

  it('keeps the listing out of caches, because it describes this profile', async () => {
    const { headers } = await fetchFolders();

    expect(headers.get('cache-control')).toBe('no-store');
  });
});
