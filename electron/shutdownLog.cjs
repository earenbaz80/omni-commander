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
let exitRegistered = false;

/**
 * Keeps the first cause. app.quit() can close every window and reach
 * window-all-closed after the tray asked to quit; that later event must not
 * replace the action that actually started the shutdown.
 */
function noteQuitReason(next) {
  if (reason === 'unknown') reason = next;
}

/** Tests start each case with no prior cause; the app never calls this. */
function resetQuitReason() {
  reason = 'unknown';
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

/** Register once, even when a test loads main.cjs again. */
function registerExitLog() {
  if (exitRegistered) return;
  exitRegistered = true;
  process.once('exit', (code) => logShutdown('process-exit', `code=${code}`));
}

module.exports = { SHUTDOWN_LOG, noteQuitReason, resetQuitReason, logShutdown, registerExitLog };
