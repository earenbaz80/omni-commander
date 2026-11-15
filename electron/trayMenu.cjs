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
function conflictOf(park) {
  const conflict = park && park.conflict;
  const destination = conflict && (conflict.destination || conflict.source);
  return destination ? { name: path.win32.basename(destination), path: destination } : null;
}

/** One line naming a parked transfer, with the subject when the line is about one. */
function waitingLine(state, park, subject) {
  return `${park.title} — ${state.labels.waiting}${subject ? ` — ${subject}` : ''}`;
}

function summaryOf(state) {
  // The newest park: it is the one the tooltip counts down and the answer row
  // below names.
  const [first] = state.waiting;
  if (first) return waitingLine(state, first, conflictOf(first)?.name);
  const task = state.task;
  if (!task) return '';
  return `${task.title}${task.progress > 0 ? ` — ${task.progress}%` : ''}`;
}

/** The wait left before the engine fails the job, when the snapshot said. */
function conflictClock(park) {
  const conflict = park && park.conflict;
  return conflict ? clockOf(conflict.expiresInMs) : '';
}

/** Rate and ETA of the selected transfer, for the tooltip only. */
function paceOf(task) {
  if (!task) return '';
  const eta = clockOf((task.etaSeconds || 0) * 1000);
  return [task.speed, eta].filter(Boolean).join(' · ');
}

function trayTooltip(state) {
  const [first] = state.waiting;
  const file = conflictOf(first);
  // Nothing parked: the line is short by construction (a title, a percent, a rate).
  if (!file) {
    return clampText([APP_NAME, summaryOf(state), paceOf(state.task)].filter(Boolean).join(' · '), TOOLTIP_LIMIT);
  }
  // The clock must never be cut, so its room is taken out of the line before the path is
  // placed: the tooltip is clamped at 120 characters, and a deep destination used to push
  // the deadline past the edge. Whatever the path cannot have, it loses from its middle,
  // where neither the drive nor the file name live.
  const head = [APP_NAME, waitingLine(state, first)].join(' · ');
  const clock = conflictClock(first);
  const clockPart = clock ? ` · ${clock}` : '';
  const room = TOOLTIP_LIMIT - head.length - clockPart.length - ' · '.length;
  if (room < 1) return clampText(`${head}${clockPart}`, TOOLTIP_LIMIT);
  return `${head}${clockPart} · ${middleEllipsis(file.path, room)}`;
}

/**
 * Keeps both ends of a path, which are the drive and the file name a user recognises the
 * conflict by; the middle is what goes when the tooltip has less room than the path needs.
 */
function middleEllipsis(text, limit) {
  if (text.length <= limit) return text;
  if (limit < 1) return '';
  if (limit === 1) return '…';
  const kept = limit - 1;
  const tail = Math.ceil(kept * 0.6);
  return `${text.slice(0, kept - tail)}…${text.slice(text.length - tail)}`;
}

/**
 * The answers the tray can give to one parked conflict, laid out like the window's
 * prompt: one decision per item, and apply-to-all as a checkbox main keeps for this
 * job across the rebuilds the queue triggers.
 */
function conflictSubmenu(state, park, actions) {
  const { labels } = state;
  const file = conflictOf(park);
  const clock = conflictClock(park);
  const applyAll = actions.applyToAll(park.jobId) === true;
  const answer = (decision) => ({
    label: labels[decision],
    click: () => actions.command({ resolve: decision, jobId: park.jobId, applyToAll: applyAll }),
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
    {
      label: labels.applyAll,
      type: 'checkbox',
      checked: applyAll,
      click: () => actions.toggleApplyToAll(park.jobId),
    },
    { type: 'separator' },
    // Stopping is an answer too, and it applies to the job, not to one file.
    {
      label: labels.cancel,
      click: () => actions.command({ resolve: 'cancel', jobId: park.jobId, applyToAll: false }),
    },
  ];
}

/**
 * The one answer row the tray offers. The queue runs one transfer at a time, so
 * there is at most one park; a second row would offer an answer the queue cannot
 * produce. The job still travels in the id, so a click landing on a rebuilt menu
 * can be traced to the transfer it answers.
 */
function answerRows(state, actions) {
  const { labels } = state;
  const [park] = state.waiting;
  // Without the conflict details there is nothing to answer, and the dashboard
  // row below already leads to the page.
  if (!park || !park.conflict) return [{ label: labels.answer, enabled: false }];
  const file = conflictOf(park);
  const clock = conflictClock(park);
  return [
    {
      id: `answer:${park.jobId}`,
      label: `${labels.answer}${file ? ` — ${file.name}` : ''}${clock ? ` · ${clock}` : ''}`,
      enabled: true,
      submenu: conflictSubmenu(state, park, actions),
    },
  ];
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
    ...answerRows(state, actions),
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
