// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fsEngine } from './fileSystem';

/**
 * A scan that comes back empty has to say why. A folder closed to this account
 * (System Volume Information, another profile) used to surface as a generic
 * "the server is not answering", which pointed at the wrong problem; these tests
 * pin the reason to the answer the server gave.
 */

const answer = (status: number) => ({ ok: false, status, body: null }) as unknown as Response;

describe('getTreeSize failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a folder closed by permissions as forbidden', async () => {
    vi.stubGlobal('fetch', async () => answer(403));

    const result = await fsEngine.getTreeSize('real_C', 'C:\\System Volume Information');

    expect(result).toEqual({ status: 'failed', reason: 'forbidden' });
  });

  it('reports a folder that is gone as notFound', async () => {
    vi.stubGlobal('fetch', async () => answer(404));

    const result = await fsEngine.getTreeSize('real_C', 'C:\\no-existe');

    expect(result).toEqual({ status: 'failed', reason: 'notFound' });
  });

  it('reports another refusal from the server as refused', async () => {
    vi.stubGlobal('fetch', async () => answer(400));

    const result = await fsEngine.getTreeSize('real_C', 'C:\\otra');

    expect(result).toEqual({ status: 'failed', reason: 'refused' });
  });

  it('reports no answer at all as unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });

    const result = await fsEngine.getTreeSize('real_C', 'C:\\datos');

    expect(result).toEqual({ status: 'failed', reason: 'unreachable' });
  });

  it('reports a server error as unreachable, the way a stopped server looks in development', async () => {
    vi.stubGlobal('fetch', async () => answer(500));

    const result = await fsEngine.getTreeSize('real_C', 'C:\\datos');

    expect(result).toEqual({ status: 'failed', reason: 'unreachable' });
  });

  it('never asks the server about a virtual drive, which has no disk to walk', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fsEngine.getTreeSize('vfs_local', 'C:');

    expect(result).toEqual({ status: 'failed', reason: 'refused' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
