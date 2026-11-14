// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createJobEngine } from './server/jobEngine.cjs';

/**
 * The engine used to be the top of `server.cjs`, where the only way to see a
 * snapshot was to start a transfer. Built as a factory it can be exercised
 * directly: what it owns is the arithmetic of progress and the bookkeeping that
 * decides when a job is over.
 */

// The module is plain JavaScript, so what the engine returns is untyped here:
// these tests describe its shape instead of restating it.
function engine(): any {
  const invalidateListings = vi.fn();
  const job = createJobEngine({ invalidateListings, jobTickMs: 1 });
  return { ...job, invalidateListings };
}

describe('createJobEngine', () => {
  it('creates a running job with an id a client can poll', () => {
    const { jobs, makeJob } = engine();
    const job = makeJob('copy', 'Copy 3 items');

    expect(job.id).toMatch(/^job_\d+_[a-z0-9]+$/);
    expect(job.status).toBe('running');
    expect(job.label).toBe('Copy 3 items');
    expect(job.op).toBe('copy');
    expect(jobs.get(job.id)).toBe(job);
  });

  it('gives every job its own id', () => {
    const { makeJob } = engine();
    const ids = new Set([makeJob('copy', 'a').id, makeJob('copy', 'b').id, makeJob('move', 'c').id]);
    expect(ids.size).toBe(3);
  });

  it('shrinks the goal by what was skipped, so a job can reach 100%', () => {
    const { makeJob, jobSnapshot } = engine();
    const job = makeJob('copy', 'Copy');
    job.totalBytes = 1000;
    job.bytesSkipped = 400;
    job.copiedBytes = 600;
    job.itemsTotal = 2;

    const snap = jobSnapshot(job);
    expect(snap.totalBytes).toBe(600);
  });

  it('reports a paused job as paused and a parked one as waiting', () => {
    const { makeJob, jobSnapshot } = engine();
    const job = makeJob('copy', 'Copy');
    expect(jobSnapshot(job).status).toBe('running');

    job.paused = true;
    expect(jobSnapshot(job).status).toBe('paused');

    job.pendingConflict = { path: 'C:/a.txt', reason: 'exists' };
    // A parked job is waiting for a human, not paused: that is what the UI polls for.
    expect(jobSnapshot(job).status).toBe('waiting');
    // A job parked without a deadline reports no time left, and one with a deadline
    // reports the wait that is left: that is what the tray counts down.
    expect(jobSnapshot(job).pendingConflict).toEqual({ path: 'C:/a.txt', reason: 'exists', expiresInMs: 0 });
    job.conflictDeadline = Date.now() + 90_000;
    expect(jobSnapshot(job).pendingConflict?.expiresInMs).toBeGreaterThan(80_000);
  });

  it('estimates speed and remaining time from the elapsed clock', () => {
    const { makeJob, jobSnapshot } = engine();
    const job = makeJob('copy', 'Copy');
    job.startedAt = Date.now() - 2000;
    job.totalBytes = 4000;
    job.copiedBytes = 2000;

    const snap = jobSnapshot(job);
    expect(snap.speedBps).toBeGreaterThan(500);
    expect(snap.etaSeconds).toBeGreaterThan(0);
    expect(snap.etaSeconds).toBeLessThan(10);
  });

  it('copies the conflict out of the snapshot so a client cannot mutate the job', () => {
    const { makeJob, jobSnapshot } = engine();
    const job = makeJob('copy', 'Copy');
    job.pendingConflict = { path: 'C:/a.txt' };

    jobSnapshot(job).pendingConflict.path = 'C:/elsewhere';
    expect(job.pendingConflict.path).toBe('C:/a.txt');
  });

  it('keeps only the tail of the per-file window', () => {
    const { makeJob, noteFile, jobSnapshot } = engine();
    const job = makeJob('copy', 'Copy');
    for (let index = 0; index < 50; index += 1) {
      noteFile(job, `C:/dir/file-${index}.txt`, index);
    }

    const files = jobSnapshot(job).recentFiles;
    expect(files).toHaveLength(40);
    expect(files[0].name).toBe('file-10.txt');
    expect(files[39].name).toBe('file-49.txt');
  });

  it('names the file with its Windows basename, not the POSIX one', () => {
    const { makeJob, noteFile } = engine();
    const job = makeJob('copy', 'Copy');
    const entry = noteFile(job, 'C:/Users/me/report.txt', 12);
    expect(entry.name).toBe('report.txt');
    expect(entry.size).toBe(12);
    expect(entry.status).toBe('copying');
  });

  it('tells the caller which job ended, and survives a listener that throws', () => {
    const ended: string[] = [];
    const watched = createJobEngine({
      onJobFinished: (job: { status: string }) => ended.push(job.status),
      jobTickMs: 1,
    });
    watched.finishJob(watched.makeJob('copy', 'Copy'));
    expect(ended).toEqual(['done']);

    // A watcher is not allowed to turn a finished transfer into a failed one.
    const broken = createJobEngine({
      onJobFinished: () => {
        throw new Error('listener');
      },
      jobTickMs: 1,
    });
    const job = broken.makeJob('copy', 'Copy');
    expect(() => broken.finishJob(job)).not.toThrow();
    expect(job.status).toBe('done');
  });

  it('ends a clean job as done and tells the caller its listings are stale', () => {
    const { makeJob, finishJob, jobSnapshot, invalidateListings } = engine();
    const job = makeJob('copy', 'Copy');
    job.copiedBytes = 10;

    finishJob(job);
    expect(job.status).toBe('done');
    expect(job.endedAt).toBeGreaterThan(0);
    expect(invalidateListings).toHaveBeenCalledTimes(1);
    expect(jobSnapshot(job).status).toBe('done');
  });

  it('separates a cancelled job from one that failed on some files', () => {
    const { makeJob, finishJob } = engine();
    const failed = makeJob('copy', 'Copy');
    // The shape the engine really records; a string here described an error the
    // producers never send, so the notice's formatter was never exercised.
    failed.errors.push({ path: 'C:/a.txt', message: 'EACCES' });
    finishJob(failed);
    expect(failed.status).toBe('done-with-errors');

    const cancelled = makeJob('copy', 'Copy');
    cancelled.cancelled = true;
    finishJob(cancelled);
    expect(cancelled.status).toBe('cancelled');
  });

  it('never leaves a finished job advertising a conflict nobody can answer', () => {
    const { makeJob, finishJob } = engine();
    const job = makeJob('copy', 'Copy');
    job.pendingConflict = { path: 'C:/a.txt' };

    finishJob(job);
    expect(job.pendingConflict).toBeNull();
  });

  it('drops the oldest finished job once the table is full', () => {
    const { jobs, makeJob, finishJob } = engine();
    const oldest = makeJob('copy', 'Oldest');
    finishJob(oldest);

    for (let index = 0; index < 200; index += 1) makeJob('copy', `Job ${index}`);

    expect(jobs.size).toBe(200);
    expect(jobs.has(oldest.id)).toBe(false);
  });

  it('will not drop live work to make room, even at the cap', () => {
    const { jobs, makeJob } = engine();
    for (let index = 0; index < 205; index += 1) makeJob('copy', `Job ${index}`);
    // Every entry is running: evicting one would lose a transfer in flight.
    expect(jobs.size).toBe(205);
  });

  it('waits while paused and lets a resume through', async () => {
    const { makeJob, waitWhilePaused } = engine();
    const job = makeJob('copy', 'Copy');
    job.paused = true;

    let resumed = false;
    const waiting = waitWhilePaused(job).then(() => {
      resumed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resumed).toBe(false);

    job.paused = false;
    await waiting;
    expect(resumed).toBe(true);
  });

  it('aborts a paused job as soon as it is cancelled', async () => {
    const { makeJob, waitWhilePaused } = engine();
    const job = makeJob('copy', 'Copy');
    job.paused = true;

    const waiting = waitWhilePaused(job);
    job.cancelled = true;
    await expect(waiting).rejects.toThrow('__cancelled__');
  });
});
