/**
 * The transfer engine's bookkeeping: the job map, its snapshots and the
 * pause/cancel checks the copy loop waits on.
 *
 * It is a factory rather than a module of shared state so a test can build a
 * fresh engine, and so the one thing it needs from the server — telling it that
 * a finished job made the directory listings stale — is handed in instead of
 * reached for. Nothing here touches the filesystem or the network.
 */

const path = require('path');

function createJobEngine(deps = {}) {
  const { invalidateListings = () => {}, jobTickMs = 120 } = deps;
  // Kept under its old name so the moved code reads exactly as it did.
  const JOB_TICK_MS = jobTickMs;

  const jobs = new Map();
  let jobSeq = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function jobSnapshot(job) {
    const elapsedSec = Math.max(0.05, ((job.endedAt || Date.now()) - job.startedAt) / 1000);
    const rate = job.copiedBytes / elapsedSec;
    // Skipped entries will never be copied, so they leave the goal. Without this a
    // job that skipped anything would sit short of 100% forever.
    const goalBytes = Math.max(0, job.totalBytes - (job.bytesSkipped || 0));
    const remaining = Math.max(0, goalBytes - job.copiedBytes);
    // A paused or waiting job is still "in flight"; exposing that as a status keeps
    // clients from polling forever or mistaking it for completion.
    let status = job.status;
    if (job.status === 'running') {
      if (job.pendingConflict) status = 'waiting';
      else if (job.paused) status = 'paused';
    }
    return {
      id: job.id,
      op: job.op,
      status,
      label: job.label,
      totalBytes: goalBytes,
      copiedBytes: job.copiedBytes,
      itemsTotal: job.itemsTotal,
      itemsDone: job.itemsDone,
      itemsSkipped: job.itemsSkipped,
      currentFile: job.currentFile,
      pendingConflict: job.pendingConflict ? { ...job.pendingConflict } : null,
      recentFiles: (job.recentFiles || []).map((f) => ({
        path: f.path,
        name: f.name,
        size: f.size,
        copied: f.copied,
        status: f.status,
      })),
      speedBps: Math.round(rate),
      etaSeconds: rate > 0 && remaining > 0 ? Math.round(remaining / rate) : 0,
      errors: job.errors,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
    };
  }

  // Per-file progress is a bounded window: a scanned tree can hold hundreds of
  // thousands of files, so the snapshot keeps only the tail of what was touched
  // instead of growing a list nobody could ever render.
  const RECENT_FILES_LIMIT = 40;
  // Finished jobs kept in memory for the UI to poll. Live jobs are never evicted.
  const JOBS_LIMIT = 200;
  const CONFLICT_ANSWER_MS = 5 * 60 * 1000;

  // Registers one entry as it enters the transfer so the UI can show a progress
  // row per file instead of only the file currently being written.
  function noteFile(job, filePath, size) {
    const entry = {
      path: filePath,
      name: path.win32.basename(filePath),
      size: Number(size) || 0,
      copied: 0,
      status: 'copying',
    };
    job.recentFiles.push(entry);
    if (job.recentFiles.length > RECENT_FILES_LIMIT) {
      job.recentFiles.splice(0, job.recentFiles.length - RECENT_FILES_LIMIT);
    }
    return entry;
  }

  function makeJob(op, label) {
    const id = `job_${++jobSeq}_${Date.now().toString(36)}`;
    const job = {
      id,
      op,
      label,
      status: 'running',
      totalBytes: 0,
      copiedBytes: 0,
      itemsTotal: 0,
      itemsDone: 0,
      itemsSkipped: 0,
      currentFile: '',
      errors: [],
      startedAt: Date.now(),
      endedAt: null,
      paused: false,
      cancelled: false,
      throttleBps: 0,
      collision: 'overwrite',
      // Bytes belonging to entries that were skipped. Tracking them separately lets
      // the progress goal shrink instead of stalling short of 100% forever.
      bytesSkipped: 0,
      // Interactive collision state: set while the transfer parks waiting for a
      // human answer, then consumed as soon as that answer arrives.
      pendingConflict: null,
      conflictDecision: null,
      // "Apply to all" promotes one answer into the policy for the whole job.
      conflictOverride: null,
      // Set by the renderer when the user accepted a shortfall in the free-space
      // prompt; only relaxes the guard, never the filesystem itself.
      force: false,
      // Tail of the files this job touched, newest last. Bounded by
      // RECENT_FILES_LIMIT so a huge tree cannot blow up the snapshot.
      recentFiles: [],
    };
    jobs.set(id, job);
    // Keep memory bounded: drop the oldest finished jobs until we are back under the
    // cap. A job parked on a conflict is live work, not garbage, so it is never
    // evicted even though its status may look terminal.
    while (jobs.size > JOBS_LIMIT) {
      let evicted = false;
      for (const [key, value] of jobs) {
        const terminal = value.status !== 'running' && value.status !== 'paused' && value.status !== 'waiting';
        if (terminal && !value.pendingConflict) {
          jobs.delete(key);
          evicted = true;
          break;
        }
      }
      // Every remaining entry is live: nothing safe to drop, so stop growing the map.
      if (!evicted) break;
    }
    return job;
  }

  function finishJob(job) {
    // Never leave a finished job advertising a conflict prompt that nobody can
    // answer any more.
    job.pendingConflict = null;
    job.endedAt = Date.now();
    if (job.cancelled) job.status = 'cancelled';
    else if (job.errors.length) job.status = 'done-with-errors';
    else job.status = 'done';
    invalidateListings();
  }

  async function waitWhilePaused(job) {
    while (job.paused && !job.cancelled) await sleep(JOB_TICK_MS);
    if (job.cancelled) throw new Error('__cancelled__');
  }

  return {
    jobs,
    makeJob,
    finishJob,
    jobSnapshot,
    noteFile,
    waitWhilePaused,
    sleep,
    jobTickMs: JOB_TICK_MS,
    conflictAnswerMs: CONFLICT_ANSWER_MS,
  };
}

module.exports = { createJobEngine };
