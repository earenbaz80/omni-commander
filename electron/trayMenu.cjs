/**
 * The tray menu, as data.
 *
 * Built inline in main.cjs it could only be inspected by starting Electron; as a
 * function of the mirrored snapshot a test can say what the menu offers for a
 * running, a paused or a parked transfer, and which row a click reaches.
 */
const path = require('node:path');
const { clockOf } = require('./clock.cjs');
const { clampText, LIVE_STATUSES } = require('./trayState.cjs');

const APP_NAME = 'OmniCommander Pro';
const TOOLTIP_LIMIT = 120;

/**
 * The file a parked conflict is about: its destination, the one being decided about,
 * falling back to the source for a snapshot that arrived without one.
 */
function conflictOf(state) {
  const conflict = state.waiting?.conflict;
  const destination = conflict && (conflict.destination || conflict.source);
  return destination ? { name: path.win32.basename(destination), path: destination } : null;
}

/** The one line naming what is waiting, with the file when there is one. */
function waitingLine(state, subject) {
  return `${state.waiting.title} — ${state.labels.waiting}${subject ? ` — ${subject}` : ''}`;
}

function summaryOf(state) {
  if (state.waiting) return waitingLine(state, conflictOf(state)?.name);
  const task = state.task;
  if (!task) return '';
  return `${task.title}${task.progress > 0 ? ` — ${task.progress}%` : ''}`;
}

/** The wait left before the engine fails the job, when the snapshot said. */
function conflictClock(state) {
  const conflict = state.waiting && state.waiting.conflict;
  return conflict ? clockOf(conflict.expiresInMs) : '';
}

function trayTooltip(state) {
  // The tooltip has room the row does not: the whole path instead of the file name,
  // because two copies can stop on the same name, plus the clock the wait runs on.
  const file = conflictOf(state);
  const summary = file ? waitingLine(state, file.path) : summaryOf(state);
  const clock = file ? conflictClock(state) : '';
  return clampText([APP_NAME, summary, clock].filter(Boolean).join(' · '), TOOLTIP_LIMIT);
}

/**
 * The answers the tray can give to a parked conflict, laid out like the window's
 * prompt: one decision per item, and apply-to-all as a checkbox main keeps across
 * the rebuilds the queue triggers.
 */
function conflictSubmenu(state, actions) {
  const { labels, waiting } = state;
  const file = conflictOf(state);
  const clock = conflictClock(state);
  const applyAll = actions.applyToAll === true;
  const answer = (decision) => ({
    label: labels[decision],
    click: () => actions.command({ resolve: decision, jobId: waiting.jobId, applyToAll: applyAll }),
  });
  return [
    // The conflict is named before the answers: the same batch can stop on one file per
    // conflict, and the answer applies to the file the user is looking at. The clock is
    // the wait left before the engine fails the job, which is what makes it urgent.
    ...(file ? [{ label: clock ? `${file.path} · ${clock}` : file.path, enabled: false }, { type: 'separator' }] : []),
    answer('overwrite'),
    answer('skip'),
    answer('rename'),
    { type: 'separator' },
    { label: labels.applyAll, type: 'checkbox', checked: applyAll, click: actions.toggleApplyToAll },
  ];
}

/**
 * The row that answers the parked conflict. Without the conflict details there is
 * nothing to answer, and the dashboard row below already leads to the page.
 */
function answerRow(state, actions) {
  const { labels, waiting } = state;
  return waiting && waiting.conflict
    ? { label: labels.answer, enabled: true, submenu: conflictSubmenu(state, actions) }
    : { label: labels.answer, enabled: false };
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
