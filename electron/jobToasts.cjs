/**
 * Which toasts reach the user, and when.
 *
 * Both cases are one-way: a transfer that ended needs its outcome told, and a
 * transfer parked on a conflict needs an answer before the engine gives up. Keeping
 * the policy here means the decision can be checked without starting Electron, and
 * main only has to supply the things the platform owns.
 */
const { conflictNotice, jobNotice } = require('./jobNotices.cjs');

/** How long before the deadline the last nudge goes out. */
const LAST_CHANCE_MS = 60 * 1000;

function createJobToasts({ Notification, isSupported, inFront, openDashboard, schedule, cancel }) {
  // Jobs already announced as waiting: a large copy can collide once per file, and a
  // toast for each would train the user to ignore them.
  const announced = new Set();
  const timers = new Map();

  const show = (jobId, notice) => {
    const toast = new Notification({ title: notice.title, body: notice.body });
    // The event Electron passes to the handler is not a job id: the toast points at the
    // transfer it announced, and only that one.
    toast.on('click', () => openDashboard(jobId));
    toast.show();
  };

  const finished = (job) => {
    if (!job) return;
    const timer = timers.get(job.id);
    if (timer !== undefined) {
      cancel(timer);
      timers.delete(job.id);
    }
    announced.delete(job.id);
    const notice = jobNotice(job);
    if (!notice || !isSupported()) return;
    show(job.id, notice);
  };

  const waiting = (job) => {
    if (!job || announced.has(job.id) || inFront()) return;
    const notice = conflictNotice(job);
    if (!notice || !isSupported()) return;
    announced.add(job.id);
    show(job.id, notice);

    // The wait is bounded, and a missed toast is a failed transfer: one more nudge just
    // before the deadline, unless the job ended in between.
    const left = Number(job.pendingConflict && job.pendingConflict.expiresInMs);
    const delay = Number.isFinite(left) ? left - LAST_CHANCE_MS : 0;
    if (delay <= 0) return;
    timers.set(
      job.id,
      schedule(() => {
        timers.delete(job.id);
        if (!announced.has(job.id)) return;
        const lastChance = conflictNotice({
          ...job,
          pendingConflict: { ...job.pendingConflict, expiresInMs: LAST_CHANCE_MS },
        });
        if (lastChance) show(job.id, lastChance);
      }, delay),
    );
  };

  const dispose = () => {
    for (const timer of timers.values()) cancel(timer);
    timers.clear();
    announced.clear();
  };

  return { dispose, finished, waiting };
}

module.exports = { LAST_CHANCE_MS, createJobToasts };
