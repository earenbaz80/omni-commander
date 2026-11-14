/**
 * The tray's mirrored snapshot of the renderer's task state.
 *
 * The renderer is the only writer, but it is still a web page: everything it
 * sends is treated as untrusted input and rebuilt here with known field types.
 * The labels come from its translations, so a missing one falls back to English
 * rather than to a menu row with nothing written in it.
 */
const TRAY_LABEL_LIMIT = 32;
const TRAY_TITLE_LIMIT = 60;
// `waiting` is a transfer the engine is holding open until someone answers a
// conflict: it is live work, not a finished one that can be dropped from the tray.
const LIVE_STATUSES = ['running', 'paused', 'queued', 'waiting'];

/** Cuts a string to a length that still fits a tray tooltip or a menu row. */
function clampText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizeTrayState(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rawTask = source.task && typeof source.task === 'object' ? source.task : null;
  const status = rawTask && LIVE_STATUSES.includes(rawTask.status) ? rawTask.status : null;
  const task = status
    ? {
        id: clampText(rawTask.id, TRAY_TITLE_LIMIT),
        title: clampText(rawTask.title, TRAY_TITLE_LIMIT) || 'Transfer',
        status,
        progress: Number.isFinite(rawTask.progress) ? Math.min(100, Math.max(0, Math.round(rawTask.progress))) : 0,
      }
    : null;
  const rawCount = Number(source.activeCount);
  const activeCount = Number.isFinite(rawCount) ? Math.min(99, Math.max(0, Math.trunc(rawCount))) : task ? 1 : 0;
  // The transfer waiting on an answer travels on its own, because the selected one
  // is chosen for the controls and may be a different task.
  const rawWaiting = source.waiting && typeof source.waiting === 'object' ? source.waiting : null;
  const waitingId = rawWaiting ? clampText(rawWaiting.id, TRAY_TITLE_LIMIT) : '';
  const rawConflict =
    rawWaiting && rawWaiting.conflict && typeof rawWaiting.conflict === 'object' ? rawWaiting.conflict : null;
  const waiting = waitingId
    ? {
        id: waitingId,
        jobId: clampText(rawWaiting.jobId, TRAY_TITLE_LIMIT),
        title: clampText(rawWaiting.title, TRAY_TITLE_LIMIT) || 'Transfer',
        // The two sides are only used to know a conflict is on screen; kept apart
        // from the title so a path cannot end up in a menu label.
        conflict: rawConflict
          ? {
              source: clampText(rawConflict.source, TRAY_TITLE_LIMIT),
              destination: clampText(rawConflict.destination, TRAY_TITLE_LIMIT),
            }
          : null,
      }
    : null;
  const rawLabels = source.labels && typeof source.labels === 'object' ? source.labels : {};

  return {
    hasLiveWork: activeCount > 0 || !!task,
    activeCount,
    // Only an explicit true enables the row: a renderer that sent nothing, or a
    // truthy string, must not offer a repeat there is no plan for.
    canRepeat: source.canRepeat === true,
    waiting,
    task,
    labels: {
      resume: clampText(rawLabels.resume, TRAY_LABEL_LIMIT) || 'Resume',
      pause: clampText(rawLabels.pause, TRAY_LABEL_LIMIT) || 'Pause',
      cancel: clampText(rawLabels.cancel, TRAY_LABEL_LIMIT) || 'Cancel',
      dashboard: clampText(rawLabels.dashboard, TRAY_LABEL_LIMIT) || 'Open transfer dashboard',
      waiting: clampText(rawLabels.waiting, TRAY_LABEL_LIMIT) || 'Waiting for your answer',
      answer: clampText(rawLabels.answer, TRAY_LABEL_LIMIT) || 'Answer the conflict',
      overwrite: clampText(rawLabels.overwrite, TRAY_LABEL_LIMIT) || 'Overwrite',
      skip: clampText(rawLabels.skip, TRAY_LABEL_LIMIT) || 'Skip',
      rename: clampText(rawLabels.rename, TRAY_LABEL_LIMIT) || 'Keep both',
      applyAll: clampText(rawLabels.applyAll, TRAY_LABEL_LIMIT) || 'Always…',
      repeat: clampText(rawLabels.repeat, TRAY_LABEL_LIMIT) || 'Repeat last cancelled or failed',
      quit: clampText(rawLabels.quit, TRAY_LABEL_LIMIT) || 'Quit',
    },
  };
}

module.exports = { clampText, LIVE_STATUSES, TRAY_LABEL_LIMIT, TRAY_TITLE_LIMIT, normalizeTrayState };
