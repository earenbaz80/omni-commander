// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCatalog } from './server/catalog.cjs';

/**
 * The catalog answers about this machine, so its numbers belong to the suites
 * that run a real server. What this file pins down is the thing an extraction
 * can break silently: the URLs the renderer asks for, and the cache handle the
 * transfer engine clears when a job finishes.
 */

function recordingApp() {
  const paths: string[] = [];
  const record = (method: string) => (routePath: string) => {
    paths.push(`${method} ${routePath}`);
  };
  return { app: { get: record('GET'), post: record('POST'), delete: record('DELETE') }, paths };
}

describe('the catalog module', () => {
  it('registers the same four paths the renderer already uses', () => {
    const { app, paths } = recordingApp();
    createCatalog({
      app,
      assertSafePath: (value: string) => value,
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
      logDebug: () => {},
    });

    expect(paths).toEqual(['GET /api/drives', 'GET /api/user-folders', 'GET /api/system/stats', 'GET /api/list']);
  });

  it('hands out a way to empty the listing cache', () => {
    const { app } = recordingApp();
    const catalog = createCatalog({
      app,
      assertSafePath: (value: string) => value,
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
      logDebug: () => {},
    });

    // A finished transfer calls this instead of holding its own Map reference.
    expect(typeof catalog.clearListCache).toBe('function');
    expect(() => catalog.clearListCache()).not.toThrow();
  });

  it('exposes the drive warm-up that runs once at boot', () => {
    const { app } = recordingApp();
    const catalog = createCatalog({
      app,
      assertSafePath: (value: string) => value,
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
      logDebug: () => {},
    });

    expect(typeof catalog.enrichDrivesFromWmi).toBe('function');
  });
});
