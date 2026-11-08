/**
 * What to do when the window's renderer process dies.
 *
 * A crashed renderer leaves the shell alive around a window that paints
 * nothing: the tray, the embedded API and any transfer in flight keep working,
 * so the app looks hung rather than gone, and nothing says why. The interface is
 * rebuilt by reloading, but a renderer that dies on every load would only repeat
 * the same death, so the attempts are counted and the reason is written down
 * first.
 *
 * It lives here, apart from main.cjs, so the decision can be tested without
 * launching Electron.
 */

/** Reloads allowed in a row, counted only while no load manages to finish. */
const MAX_RENDERER_RELOADS = 3;

/**
 * The line the log gets. The reason separates a crash from an out-of-memory
 * kill, and the exit code is what a native fault leaves behind.
 */
function rendererGoneLine(details) {
  const reason = typeof details?.reason === 'string' && details.reason ? details.reason : 'unknown';
  const exitCode = Number.isInteger(details?.exitCode) ? details.exitCode : 'unknown';
  return `reason=${reason} exitCode=${exitCode}`;
}

/** Whether the interface gets one more reload, given the deaths since the last load. */
function canReloadRenderer(crashes, max = MAX_RENDERER_RELOADS) {
  return Number.isFinite(crashes) && crashes < max;
}

module.exports = {
  MAX_RENDERER_RELOADS,
  rendererGoneLine,
  canReloadRenderer,
};
