// @vitest-environment node
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createCatalog } from './server/catalog.cjs';

/**
 * The catalog answers about this machine, so its numbers belong to the suites
 * that run a real server. What this file pins down is the thing an extraction
 * can break silently: the URLs the renderer asks for, and the cache handle the
 * transfer engine clears when a job finishes.
 */

function recordingApp() {
  const paths: string[] = [];
  const handlers: Record<string, (req: unknown, res: unknown) => unknown> = {};
  const record = (method: string) => (routePath: string, handler: (req: unknown, res: unknown) => unknown) => {
    paths.push(`${method} ${routePath}`);
    handlers[`${method} ${routePath}`] = handler;
  };
  return { app: { get: record('GET'), post: record('POST'), delete: record('DELETE') }, paths, handlers };
}

describe('the catalog module', () => {
  it('registers the paths the renderer already uses', () => {
    const { app, paths } = recordingApp();
    createCatalog({
      app,
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
    });

    expect(paths).toEqual([
      'GET /api/platform',
      'GET /api/drives',
      'GET /api/user-folders',
      'GET /api/system/stats',
      'GET /api/list',
    ]);
  });

  it('hands out a way to empty the listing cache', () => {
    const { app } = recordingApp();
    const catalog = createCatalog({
      app,
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
    });

    // A finished transfer calls this instead of holding its own Map reference.
    expect(typeof catalog.clearListCache).toBe('function');
    expect(() => catalog.clearListCache()).not.toThrow();
  });

  it('exposes the drive warm-up that runs once at boot', () => {
    const { app } = recordingApp();
    const catalog = createCatalog({
      app,
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
    });

    expect(typeof catalog.enrichDrivesFromWmi).toBe('function');
  });

  it('serves drives and warm-up through the injected platform', async () => {
    const { app, handlers } = recordingApp();
    const drives = [
      {
        id: 'real_C',
        letter: 'C:',
        name: 'System',
        type: 'local',
        driveKind: 'fixed',
        totalBytes: 1,
        freeBytes: 1,
        isMounted: true,
      },
    ];
    let warmUps = 0;
    const catalog = createCatalog({
      app,
      platform: {
        id: 'win32',
        capabilities: { volumes: true, paths: true },
        paths: { pathApi: path.win32 },
        volumes: {
          list: async () => drives,
          warmUp: async () => {
            warmUps += 1;
          },
        },
      },
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
    });
    let body: unknown;
    const response = {
      json: (value: unknown) => {
        body = value;
      },
      status: () => response,
    };

    await handlers['GET /api/drives']({}, response);
    expect(body).toEqual(drives);
    await catalog.enrichDrivesFromWmi();
    expect(warmUps).toBe(1);
  });

  it('lists a POSIX folder through path.posix and the volume root', async () => {
    const { app, handlers } = recordingApp();
    const stat = { size: 12, mtime: new Date(), birthtime: new Date(), mode: 0o644 };
    createCatalog({
      app,
      fs: {
        promises: {
          readdir: async () => [
            { name: 'nota.txt', isDirectory: () => false },
            { name: 'sub', isDirectory: () => true },
          ],
          stat: async () => stat,
        },
      },
      platform: {
        id: 'linux',
        capabilities: { volumes: true, paths: true },
        paths: { pathApi: path.posix },
        volumes: {
          list: async () => [
            {
              id: 'real_root',
              letter: '/',
              name: 'Sistema',
              type: 'local',
              driveKind: 'fixed',
              totalBytes: 1,
              freeBytes: 1,
              isMounted: true,
            },
          ],
          warmUp: async () => {},
        },
      },
      readSystemStats: async () => ({}),
      readElevation: async () => false,
      readUserLibraries: async () => ({}),
    });
    let body: unknown;
    const response = {
      json: (value: unknown) => {
        body = value;
      },
      status: () => response,
    };

    await handlers['GET /api/list']({ query: { driveId: 'real_root', path: '/tmp' } }, response);

    expect(body).toEqual([
      expect.objectContaining({ name: 'nota', ext: 'TXT', fullName: 'nota.txt', isDirectory: false, size: 12 }),
      expect.objectContaining({ name: 'sub', fullName: 'sub', isDirectory: true, size: 0 }),
    ]);
  });
});
