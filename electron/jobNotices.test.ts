// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { conflictNotice } = require('./jobNotices.cjs');

/**
 * The toast for a parked transfer is the only surface that reaches a user whose
 * window is behind something else, and the wait it reports expires into a failed
 * job. So what it says has to be enough to act on: which transfer stopped, and on
 * which file.
 */
describe('the toast for a parked transfer', () => {
  it('names the transfer and the file it stopped on', () => {
    // The shape the server really announces: the engine holds a job that is still
    // `running`, and `waiting` is only what the snapshot derives from the conflict.
    const notice = conflictNotice({
      id: 'job-1',
      status: 'running',
      label: 'respaldo',
      pendingConflict: { source: 'C:\\copias\\foto.jpg', destination: 'D:\\respaldo\\foto.jpg' },
    });

    expect(notice).toEqual({ title: 'respaldo', body: '⏸ D:\\respaldo\\foto.jpg' });
  });

  it('has nothing to say about work that is not parked', () => {
    const conflict = { destination: 'D:\\respaldo\\foto.jpg' };

    expect(conflictNotice({ status: 'running', label: 'respaldo' })).toBeNull();
    expect(conflictNotice({ status: 'done', label: 'respaldo' })).toBeNull();
    // A finished job that still carried a conflict is a late snapshot, not a wait.
    expect(conflictNotice({ status: 'done-with-errors', label: 'respaldo', pendingConflict: conflict })).toBeNull();
    expect(conflictNotice(null)).toBeNull();
  });

  it('says how long is left before the engine gives up', () => {
    const notice = conflictNotice({
      status: 'running',
      label: 'respaldo',
      pendingConflict: { destination: 'D:\\a.txt', expiresInMs: 90 * 1000 },
    });

    expect(notice?.body).toBe('⏸ D:\\a.txt · 1:30');
  });

  it('still speaks up when the renderer sent no label', () => {
    const notice = conflictNotice({ status: 'running', pendingConflict: { destination: 'D:\\a.txt' } });

    expect(notice?.title).toBe('Transfer');
    expect(notice?.body).toBe('⏸ D:\\a.txt');
  });
});
