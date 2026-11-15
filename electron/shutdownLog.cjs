/**
 * A one-line trail for the ways the main process can end. The app has more than
 * one exit path, and a window that disappears tells us nothing about which one
 * ran. These lines are written synchronously so the last one is on disk before
 * the process goes away; a forced kill leaves no exit line, which is itself the
 * useful distinction.
 */

const { appendLogSync } = require('../server/scratch.cjs');

const SHUTDOWN_LOG = 'omnicommander-shutdown.log';

let reason = 'unknown';

/**
 * Keeps the first cause. app.quit() can close every window and reach
 * window-all-closed after the tray asked to quit; that later event must not
 * replace the action that actually started the shutdown.
 */
function noteQuitReason(next) {
  if (reason === 'unknown') reason = next;
}

function shutdownLine(event, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  return `${new Date().toISOString()} pid=${process.pid} event=${event} reason=${reason}${suffix}`;
}

/** Logging must never be the reason a shutdown fails. */
function logShutdown(event, detail = '') {
  try {
    appendLogSync(SHUTDOWN_LOG, shutdownLine(event, detail));
  } catch {
    // A missing diagnostic line is preferable to a refused shutdown.
  }
}

function registerExitLog() {
  process.once('exit', (code) => logShutdown('process-exit', `code=${code}`));
}

module.exports = { noteQuitReason, logShutdown, registerExitLog };
