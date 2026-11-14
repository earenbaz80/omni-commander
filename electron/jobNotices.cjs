/**
 * Which finished transfers are worth a notification, and what it says.
 *
 * A copy can end with the window closed, and then the only record of it is a row
 * in the dashboard. The rules live here so they can be checked without Electron;
 * the caller only has to show what comes back.
 */
const { formatBytes } = require('../server/formatBytes.cjs');

/** A copy is worth interrupting someone for only if it ran long enough to forget. */
const NOTICE_MIN_MS = 10 * 1000;
const FAILED = new Set(['error', 'done-with-errors']);

/** The engine records a failure as `{ path, message }`; anything else is nothing to say. */
function describeError(error) {
  return error && typeof error.message === 'string' ? error.message.trim() : '';
}

/**
 * The notification for a job that just ended, or null when it should stay quiet:
 * a cancellation was asked for, and a two-second copy can be watched ending.
 * A failure is worth saying however quick it was.
 */
function jobNotice(job, now = Date.now()) {
  if (!job || typeof job !== 'object') return null;
  const failed = FAILED.has(job.status);
  if (job.status !== 'done' && !failed) return null;
  const startedAt = Number(job.startedAt);
  const endedAt = Number(job.endedAt) || now;
  if (!failed && Number.isFinite(startedAt) && endedAt - startedAt < NOTICE_MIN_MS) return null;

  const label = (typeof job.label === 'string' && job.label.trim()) || 'Transfer';
  const size = `${formatBytes(Number(job.copiedBytes) || 0)} / ${formatBytes(Number(job.totalBytes) || 0)}`;
  const first = failed && Array.isArray(job.errors) ? describeError(job.errors[0]) : '';
  // The window's words are translated by the renderer and this process has none of
  // its own, so the outcome is a mark rather than an English word in a menu.
  return { title: label, body: `${failed ? '⚠' : '✓'} ${size}${first ? ` — ${first}` : ''}` };
}

/**
 * A transfer parked on a conflict. Unlike the notices above, this one is raised while
 * the work is still alive: the wait is bounded, and a job that expires fails without
 * the user ever having seen the prompt. The title names the transfer, the mark says
 * why, and the body names the file it stopped on -- the process has no translations
 * of its own, so the state is a mark rather than an English word.
 */
function conflictNotice(job) {
  if (!job || typeof job !== 'object' || job.status !== 'waiting') return null;
  const conflict = job.pendingConflict;
  if (!conflict || typeof conflict !== 'object') return null;
  const label = (typeof job.label === 'string' && job.label.trim()) || 'Transfer';
  const destination = typeof conflict.destination === 'string' ? conflict.destination : '';
  return { title: label, body: `⏸ ${destination}`.trim() };
}

module.exports = { conflictNotice, jobNotice };
