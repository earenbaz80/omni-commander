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
  const rawLabels = source.labels && typeof source.labels === 'object' ? source.labels : {};

  return {
    hasLiveWork: activeCount > 0 || !!task,
    activeCount,
    // Only an explicit true enables the row: a renderer that sent nothing, or a
    // truthy string, must not offer a repeat there is no plan for.
    canRepeat: source.canRepeat === true,
    task,
    labels: {
      resume: clampText(rawLabels.resume, TRAY_LABEL_LIMIT) || 'Resume',
      pause: clampText(rawLabels.pause, TRAY_LABEL_LIMIT) || 'Pause',
      cancel: clampText(rawLabels.cancel, TRAY_LABEL_LIMIT) || 'Cancel',
      dashboard: clampText(rawLabels.dashboard, TRAY_LABEL_LIMIT) || 'Open transfer dashboard',
      waiting: clampText(rawLabels.waiting, TRAY_LABEL_LIMIT) || 'Waiting for your answer',
      repeat: clampText(rawLabels.repeat, TRAY_LABEL_LIMIT) || 'Repeat last cancelled',
      quit: clampText(rawLabels.quit, TRAY_LABEL_LIMIT) || 'Quit',
    },
  };
}

module.exports = { clampText, LIVE_STATUSES, normalizeTrayState };
