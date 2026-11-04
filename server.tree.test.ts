// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { registerTreeRoutes } from './server/tree.cjs';

/**
 * A tree scan and a TreeSize walk both need real folders, which the suites that
 * start the server already give them. This file only fixes the URLs and the
 * dependency the module borrows: the shared directory listing.
 */

describe('the tree module', () => {
  it('registers the shallow tree and the recursive size', () => {
    const paths: string[] = [];
    const record = (method: string) => (routePath: string) => {
      paths.push(`${method} ${routePath}`);
    };
    registerTreeRoutes({ get: record('GET'), post: record('POST'), delete: record('DELETE') } as never, {
      assertSafePath: (value: string) => value,
      logDebug: () => {},
      listDirectory: async () => ({}),
    });

    expect(paths).toEqual(['GET /api/tree', 'GET /api/treesize']);
  });
});
