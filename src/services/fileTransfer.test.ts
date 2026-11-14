// @vitest-environment node
// The poller is plain timers and fetch, so the DOM would only slow it down.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '../types';
import { createTransferOps, lostJobRetryPolicy, type RealFsJob, type TransferOpsDeps } from './fileTransfer';

const { fetchWithRetry } = vi.hoisted(() => ({ fetchWithRetry: vi.fn() }));
vi.mock('../utils/fetchWithRetry', () => ({ fetchWithRetry }));

function item(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1',
    driveId: 'C:',
    path: 'C:\\origen',
    fullName: 'nota.txt',
    name: 'nota',
    ext: 'txt',
    isDirectory: false,
    size: 4,
    createdAt: '2024-01-01T00:00:00.000Z',
    modifiedAt: '2024-01-01T00:00:00.000Z',
    attributes: { readOnly: false, hidden: false, system: false, archive: false },
    ...overrides,
  };
}

function snapshot(overrides: Partial<RealFsJob> = {}): RealFsJob {
  return {
    id: 'job-1',
    op: 'copy',
    status: 'running',
    totalBytes: 10,
    copiedBytes: 5,
    itemsTotal: 2,
    itemsDone: 1,
    itemsSkipped: 0,
    currentFile: '',
    pendingConflict: null,
    recentFiles: [],
    speedBps: 0,
    etaSeconds: 0,
    errors: [],
    ...overrides,
  };
}

/** A snapshot the poller can read, shaped like the response it expects. */
const answer = (overrides: Partial<RealFsJob> = {}) => ({
  status: 200,
  ok: true,
  json: async () => snapshot(overrides),
});

function harness(overrides: Partial<TransferOpsDeps> = {}) {
  const deps: TransferOpsDeps = {
    callServerFs: async () => null,
    lastCallError: () => '',
    normalizePath: (path) => path,
    realAbsolutePath: (file) => `${file.driveId}${file.fullName ?? ''}`,
    realEntryName: (file) => file.fullName ?? '',
    isSystemDrive: () => true,
    loadSystemDriveDirectory: async () => true,
    catalogueEntryAt: () => undefined,
    ...overrides,
  };
  return createTransferOps(deps);
}

beforeEach(() => {
  fetchWithRetry.mockReset();
});

describe('fileTransfer', () => {
  it('raises one prompt per destination while the same conflict stays parked', async () => {
    const previous = { ...lostJobRetryPolicy };
    lostJobRetryPolicy.pollDelayMs = 1;
    try {
      const conflict = { source: 'C:\\a', destination: 'C:\\b\\a' };
      fetchWithRetry
        .mockResolvedValueOnce(answer({ status: 'waiting', pendingConflict: conflict }))
        .mockResolvedValueOnce(answer({ status: 'waiting', pendingConflict: conflict }))
        .mockResolvedValue(answer({ status: 'done' }));

      const onConflict = vi.fn();
      const job = await harness().awaitServerJob('job-1', undefined, undefined, undefined, onConflict);

      expect(onConflict).toHaveBeenCalledTimes(1);
      expect(onConflict.mock.calls[0][0]).toMatchObject({ jobId: 'job-1', name: 'a', destination: 'C:\\b\\a' });
      expect(job?.status).toBe('done');
    } finally {
      Object.assign(lostJobRetryPolicy, previous);
    }
  });

  it('reports the prompt gone once the job is no longer parked', async () => {
    const previous = { ...lostJobRetryPolicy };
    lostJobRetryPolicy.pollDelayMs = 1;
    try {
      // Answered elsewhere -- from the tray or the dashboard -- so nothing local
      // closed the prompt: the poll is the only place that sees the job move on,
      // and the transfer keeps running after the answer.
      const conflict = { source: 'C:\\a', destination: 'C:\\b\\a' };
      fetchWithRetry
        .mockResolvedValueOnce(answer({ status: 'waiting', pendingConflict: conflict }))
        .mockResolvedValueOnce(answer({ status: 'waiting', pendingConflict: conflict }))
        .mockResolvedValueOnce(answer({ status: 'running' }))
        .mockResolvedValue(answer({ status: 'done' }));

      const onConflict = vi.fn();
      const onConflictEnd = vi.fn();
      await harness().awaitServerJob('job-1', undefined, undefined, undefined, onConflict, onConflictEnd);

      expect(onConflict).toHaveBeenCalledTimes(1);
      // Once per prompt, not once per poll that finds the job unparked.
      expect(onConflictEnd.mock.calls).toEqual([['job-1']]);
    } finally {
      Object.assign(lostJobRetryPolicy, previous);
    }
  });

  it('declares a transfer lost when the server stops answering, instead of a success', async () => {
    const previous = { ...lostJobRetryPolicy };
    lostJobRetryPolicy.maxPolls = 1;
    lostJobRetryPolicy.pollDelayMs = 1;
    try {
      fetchWithRetry.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(harness().awaitServerJob('job-1')).rejects.toThrow(/Transfer lost/i);
    } finally {
      Object.assign(lostJobRetryPolicy, previous);
    }
  });

  it('surfaces the reason a transfer could not start', async () => {
    const ops = harness({
      callServerFs: async () => null,
      lastCallError: () => 'Unsafe path: C:\\..\\secret',
    });
    await expect(ops.transferPaths('copy', ['C:\\a'], 'C:\\b', true)).rejects.toThrow(
      'Copy could not start: Unsafe path: C:\\..\\secret',
    );
  });

  it('reports the size the server measured and fails on a job that ends with errors', async () => {
    const ops = harness({ callServerFs: async () => ({ jobId: 'job-9', totalBytes: 2048, itemsTotal: 3 }) });
    fetchWithRetry.mockResolvedValue(
      answer({ id: 'job-9', status: 'done-with-errors', errors: [{ path: 'C:\\x', message: 'denied' }] }),
    );

    const started: Array<{ totalBytes: number; itemsTotal: number; jobId: string }> = [];
    await expect(
      ops.transferPaths(
        'copy',
        ['C:\\a'],
        'C:\\b',
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (info) => started.push(info),
      ),
    ).rejects.toThrow('denied');

    expect(started).toEqual([{ totalBytes: 2048, itemsTotal: 3, jobId: 'job-9' }]);
  });

  it('tells the engine when a repeated batch continues an earlier one', async () => {
    const bodies: unknown[] = [];
    const ops = harness({
      callServerFs: async (_route, body) => {
        bodies.push(body);
        return { jobId: 'job-1' };
      },
    });
    fetchWithRetry.mockResolvedValue(answer({ status: 'done' }));

    await ops.transferPaths('copy', ['C:\\a'], 'C:\\b', true, undefined, undefined, {
      collision: 'ask',
      throttleBps: 0,
      resume: true,
    });

    // The flag is what the engine reads to skip the entries the earlier run copied.
    expect(bodies).toEqual([expect.objectContaining({ resume: true })]);
  });

  it('returns the catalogue entry a moved file left behind and reloads both folders', async () => {
    const reloads: string[] = [];
    const landed = item({ driveId: 'T:', path: 'T:\\dest' });
    const ops = harness({
      callServerFs: async () => ({ jobId: 'job-1' }),
      loadSystemDriveDirectory: async (driveId, path) => {
        reloads.push(`${driveId}|${path}`);
        return true;
      },
      catalogueEntryAt: () => landed,
    });
    fetchWithRetry.mockResolvedValue(answer({ status: 'done' }));

    const result = await ops.realCopyOrMove(item(), 'move', 'T:', 'T:\\dest', true);

    expect(result).toBe(landed);
    expect(reloads).toEqual(['T:|T:\\dest', 'C:|C:\\origen']);
  });
});
