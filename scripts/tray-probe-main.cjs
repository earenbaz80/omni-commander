'use strict';

/**
 * Development harness for the tray's conflict menu.
 *
 * It runs inside the real main process when `TRAY_PROBE=1`; see
 * `scripts/tray-probe.mjs` for the launcher and the assertions. The parks are
 * injected into the same `trayState` the renderer feeds, the menu is rebuilt,
 * and the single row's apply-to-all and Skip are clicked through their real
 * handlers.
 */

const WAITING = [
  {
    id: 'task_a',
    jobId: 'job_a',
    title: 'Copy A',
    conflict: { source: 'C:\\src\\a.txt', destination: 'D:\\dest\\a.txt', expiresInMs: 300000 },
  },
];

function rows(menu) {
  return ((menu && menu.items) || [])
    .filter((item) => typeof item.id === 'string' && item.id.startsWith('answer:'))
    .map((item) => {
      const box = ((item.submenu && item.submenu.items) || []).find((entry) => entry.type === 'checkbox');
      return { id: item.id, label: item.label, applyToAll: Boolean(box && box.checked) };
    });
}

function checkedByJob(menu) {
  return Object.fromEntries(rows(menu).map((row) => [row.id.slice('answer:'.length), row.applyToAll]));
}

function clickApplyToAll(menu, jobId) {
  const row = ((menu && menu.items) || []).find((item) => item.id === `answer:${jobId}`);
  const box = ((row && row.submenu && row.submenu.items) || []).find((entry) => entry.type === 'checkbox');
  if (!box) throw new Error(`No apply-to-all checkbox on ${jobId}`);
  box.click();
}

function clickAnswer(menu, jobId, label) {
  const row = ((menu && menu.items) || []).find((item) => item.id === `answer:${jobId}`);
  const answer = ((row && row.submenu && row.submenu.items) || []).find((entry) => entry.label === label);
  if (!answer) throw new Error(`No ${label} answer on ${jobId}`);
  answer.click();
}

/**
 * Watches what main actually sends to the renderer. The menu actions call
 * `sendTrayCommand`, so pretending to click a row is not enough: the payload
 * has to leave through the same IPC channel the real click uses.
 */
function captureTrayCommands(api) {
  const contents = api.window() && api.window().webContents;
  if (!contents || typeof contents.send !== 'function') throw new Error('No renderer to observe tray commands');
  const commands = [];
  const send = contents.send.bind(contents);
  contents.send = (channel, payload) => {
    if (channel === 'tray:command') commands.push(payload);
    return send(channel, payload);
  };
  return commands;
}

function run(api) {
  const result = { ok: false };
  try {
    const commands = captureTrayCommands(api);
    api.inject({ activeCount: 2, canRepeat: false, waiting: WAITING });
    result.rows = rows(api.menu());
    result.initial = checkedByJob(api.menu());

    clickApplyToAll(api.menu(), 'job_a');
    result.afterA = checkedByJob(api.menu());

    clickAnswer(api.menu(), 'job_a', 'Skip');
    result.commands = commands;

    result.menuOpened = api.open();
    if (!result.menuOpened) throw new Error('The tray is not available to open the menu');
    result.ok = true;
  } catch (error) {
    result.error = error && error.stack ? error.stack : String(error);
  }
  process.stdout.write(`TRAY_PROBE_RESULT ${JSON.stringify(result)}\n`);
  setTimeout(() => api.quit(result.ok ? 0 : 1), result.ok ? 1500 : 200);
}

module.exports = { run };
