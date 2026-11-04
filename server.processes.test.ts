// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { registerProcessRoutes } from './server/processes.cjs';

/**
 * Both answers are PowerShell reads, so their content is covered where the real
 * server runs. Here the point is the wiring: the two URLs, registered the same
 * way they were before the module moved.
 */

describe('the process module', () => {
  it('registers the process list and the network adapters', () => {
    const paths: string[] = [];
    const record = (method: string) => (routePath: string) => {
      paths.push(`${method} ${routePath}`);
    };
    registerProcessRoutes({ get: record('GET'), post: record('POST'), delete: record('DELETE') } as never, {
      logDebug: () => {},
      listDirectory: async () => ({}),
      powershellTimeoutMs: 1000,
    });

    expect(paths).toEqual(['GET /api/net/adapters', 'GET /api/processes']);
  });
});
