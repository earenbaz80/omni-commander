/**
 * The tray menu, as data.
 *
 * Built inline in main.cjs it could only be inspected by starting Electron; as a
 * function of the mirrored snapshot a test can say what the menu offers for a
 * running, a paused or a parked transfer, and which row a click reaches.
 */
const path = require('node:path');
const { clampText, LIVE_STATUSES } = require('./trayState.cjs');

const APP_NAME = 'OmniCommander Pro';
const TOOLTIP_LIMIT = 120;

/**
 * The file a parked conflict is about. The destination is the one that decides it --
 * "replace this?" -- so it names the conflict, with the source as the fallback for a
 * snapshot that arrived without it. Both are paths the menu can show: the row uses the
 * file name, the tooltip and the submenu the whole path.
 */
function conflictOf(state) {
  const conflict = state.waiting && state.waiting.conflict;
  if (!conflict) return null;
  const destination = conflict.destination || conflict.source;
  if (!destination) return null;
  return { name: path.win32.basename(destination), path: destination };
}

/**
 * The line that describes the transfer the tray is about. A job the engine parked is
 * what the user has to act on, so it names the line even when the controls are on
 * another task -- and names the file it stopped on, since "a transfer is waiting"
 * says nothing about which of its files needs an answer.
 */
function summaryOf(state) {
  if (state.waiting) {
    const line = `${state.waiting.title} — ${state.labels.waiting}`;
    const file = conflictOf(state);
    return file ? `${line} — ${file.name}` : line;
  }
  const task = state.task;
  if (!task) return '';
  return `${task.title}${task.progress > 0 ? ` — ${task.progress}%` : ''}`;
}

function trayTooltip(state) {
  // The tooltip has room the row does not, so the conflict is named by its path instead
  // of just the file name: two copies of `a.txt` stop on the same word.
  const file = conflictOf(state);
  const summary = file ? `${state.waiting.title} — ${state.labels.waiting} — ${file.path}` : summaryOf(state);
  return clampText(summary ? `${APP_NAME} · ${summary}` : APP_NAME, TOOLTIP_LIMIT);
}

/**
 * The answers the tray can give to a parked conflict, laid out like the window's
 * prompt: one decision per item, and apply-to-all as a checkbox main keeps across
 * the rebuilds the queue triggers.
 */
function conflictSubmenu(state, actions) {
  const { labels, waiting } = state;
  const file = conflictOf(state);
  const applyAll = actions.applyToAll === true;
  const answer = (decision) => ({
    label: labels[decision],
    click: () => actions.command({ resolve: decision, jobId: waiting.jobId, applyToAll: applyAll }),
  });
  return [
    // The conflict is named before the answers: the same batch can stop on one file per
    // conflict, and the answer applies to the file the user is looking at.
    ...(file ? [{ label: file.path, enabled: false }, { type: 'separator' }] : []),
    answer('overwrite'),
    answer('skip'),
    answer('rename'),
    { type: 'separator' },
    { label: labels.applyAll, type: 'checkbox', checked: applyAll, click: actions.toggleApplyToAll },
  ];
}

/**
 * The row that answers a parked conflict, or leads to the job's own page when there is
 * no conflict to answer -- a transfer can be waiting without the details having arrived.
 */
function answerRow(state, actions) {
  const { labels, waiting } = state;
  if (!waiting) return { label: labels.answer, enabled: false };
  if (waiting.conflict) return { label: labels.answer, enabled: true, submenu: conflictSubmenu(state, actions) };
  return { label: labels.answer, enabled: actions.dashboardReady, click: () => actions.openDashboard(waiting.id) };
}

/**
 * Resume and Pause are mutually exclusive, so the menu always states what a click
 * will do; the dashboard row is enabled exactly when a page can be addressed.
 */
function trayMenuTemplate(state, actions) {
  const { activeCount, labels } = state;
  const status = state.task?.status ?? null;
  return [
    { label: activeCount > 1 ? `${APP_NAME} (${activeCount})` : APP_NAME, click: actions.showWindow },
    { type: 'separator' },
    { label: summaryOf(state) || '—', enabled: false },
    answerRow(state, actions),
    { label: labels.resume, enabled: status === 'paused', click: () => actions.command('resume') },
    { label: labels.pause, enabled: status === 'running', click: () => actions.command('pause') },
    // The live statuses are exactly the ones a cancel still has something to stop.
    { label: labels.cancel, enabled: LIVE_STATUSES.includes(status), click: () => actions.command('cancel') },
    { label: labels.repeat, enabled: state.canRepeat, click: () => actions.command('repeat') },
    { label: labels.dashboard, enabled: actions.dashboardReady, click: actions.openDashboard },
    { type: 'separator' },
    { label: labels.quit, click: actions.quit },
  ];
}

module.exports = { trayTooltip, trayMenuTemplate };
