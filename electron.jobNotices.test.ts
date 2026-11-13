// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jobNotice } from './electron/jobNotices.cjs';

/**
 * A transfer can outlive the window, so its end can happen with nobody watching.
 * These cases pin when that is worth a toast: it must not fire for a cancellation
 * the user asked for, nor for a copy that took a couple of seconds, and a failure
 * must always say what went wrong.
 */
describe('the notice for a finished transfer', () => {
  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    label: 'Copiar 1 elemento(s)',
    status: 'done',
    copiedBytes: 512 * 1024 * 1024,
    totalBytes: 1024 * 1024 * 1024,
    errors: [],
    startedAt: 1_000_000,
    endedAt: 1_000_000 + 60_000,
    ...overrides,
  });

  it('says which transfer ended and how much it moved', () => {
    expect(jobNotice(job())).toEqual({ title: 'Copiar 1 elemento(s)', body: '✓ 512.0 MB / 1.0 GB' });
  });

  it('names the first failure, however quick it was', () => {
    const notice = jobNotice(
      job({
        status: 'done-with-errors',
        errors: [{ path: 'C:/a.txt', message: 'EACCES: permission denied' }],
        startedAt: 2_000_000,
        endedAt: 2_000_500,
      }),
    );
    expect(notice?.body).toBe('⚠ 512.0 MB / 1.0 GB — EACCES: permission denied');
  });

  it('stays quiet for what the user asked to stop', () => {
    for (const status of ['cancelled', 'running', 'paused', 'waiting']) {
      expect(jobNotice(job({ status })), status).toBeNull();
    }
  });

  it('stays quiet for a copy short enough to watch end', () => {
    expect(jobNotice(job({ endedAt: 1_000_000 + 2_000 }))).toBeNull();
  });

  it('falls back to a plain title when the job has no label', () => {
    expect(jobNotice(job({ label: '   ' }))?.title).toBe('Transfer');
  });

  it('has nothing to say about something that is not a job', () => {
    expect(jobNotice(null)).toBeNull();
    expect(jobNotice(undefined)).toBeNull();
    expect(jobNotice('done')).toBeNull();
  });
});
