/**
 * The tray menu, as data.
 *
 * Built inline in main.cjs it could only be inspected by starting Electron; as a
 * function of the mirrored snapshot a test can say what the menu offers for a
 * running, a paused or a parked transfer, and which row a click reaches.
 */
const { clampText } = require('./trayState.cjs');

const APP_NAME = 'OmniCommander Pro';
const TOOLTIP_LIMIT = 120;
/** Statuses a cancel is valid for: the transfer still has something to stop. */
const CANCELLABLE = new Set(['running', 'paused', 'queued', 'waiting']);

/** The line that describes the selected transfer. */
function summaryOf(state) {
  const task = state.task;
  if (!task) return '';
  if (task.status === 'waiting') return `${task.title} — ${state.labels.waiting}`;
  return `${task.title}${task.progress > 0 ? ` — ${task.progress}%` : ''}`;
}

function trayTooltip(state) {
  const summary = summaryOf(state);
  return clampText(summary ? `${APP_NAME} · ${summary}` : APP_NAME, TOOLTIP_LIMIT);
}

/**
 * Resume and Pause are mutually exclusive, so the menu always states what a click
 * will do; the dashboard row is enabled exactly when a page can be addressed.
 */
function trayMenuTemplate(state, actions) {
  const { activeCount, labels } = state;
  const status = state.task ? state.task.status : null;
  return [
    { label: activeCount > 1 ? `${APP_NAME} (${activeCount})` : APP_NAME, click: actions.showWindow },
    { type: 'separator' },
    { label: summaryOf(state) || '—', enabled: false },
    { label: labels.resume, enabled: status === 'paused', click: () => actions.command('resume') },
    { label: labels.pause, enabled: status === 'running', click: () => actions.command('pause') },
    { label: labels.cancel, enabled: CANCELLABLE.has(status), click: () => actions.command('cancel') },
    { label: labels.dashboard, enabled: actions.dashboardReady, click: actions.openDashboard },
    { type: 'separator' },
    { label: labels.quit, click: actions.quit },
  ];
}

module.exports = { summaryOf, trayTooltip, trayMenuTemplate };
