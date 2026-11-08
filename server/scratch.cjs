/**
 * Where the app writes the files it needs while it runs.
 *
 * Two of them used to land in the system temporary folder: the PowerShell
 * helpers behind a shortcut or a Recycle Bin delete (one per process id, left
 * behind for good) and the map's offline cache, dropped there by any run that
 * started without Electron to point at a profile. A launch in development then
 * left a script and a tile folder in %TEMP% that nobody ever cleaned, which is
 * the kind of trace a machine that only ran the app should not carry.
 *
 * The diagnostic logs were the same story with a worse ending: a transfer that
 * stalls appends a line every couple of seconds, so a log left in the temp
 * folder grew until the folder was cleaned, and the line that explained the
 * trouble was at the top of a file nobody opened. They live in the app's own
 * folder now and are rotated, so the newest history is always the one on disk.
 *
 * The scripts are taken away when the process exits; the map cache is kept, as
 * a saved area has to survive a restart.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR_NAME = 'omnicommander-pro';

/**
 * The folder the app keeps its data in, resolved without Electron to ask. It
 * matches what `app.getPath('userData')` returns, so a bare server run and the
 * packaged app write to the same place instead of two.
 */
function appDataDir() {
  const explicit = String(process.env.OMNI_DATA_DIR || '').trim();
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    const roaming = String(process.env.APPDATA || '').trim();
    if (roaming) return path.join(roaming, APP_DIR_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
  }
  return path.join(
    String(process.env.XDG_CONFIG_HOME || '').trim() || path.join(os.homedir(), '.config'),
    APP_DIR_NAME,
  );
}

/** The throwaway folder: helper scripts only, safe to lose at any moment. */
function scratchDir() {
  const explicit = String(process.env.OMNI_SCRATCH_DIR || '').trim();
  return explicit || path.join(appDataDir(), 'tmp');
}

/**
 * The offline map cache. Not a scratch file: an area saved before a flight has
 * to survive a restart, so it is pruned by budget rather than emptied on exit.
 */
function mapTilesDir() {
  const explicit = String(process.env.OMNI_MAP_CACHE_DIR || '').trim();
  return explicit || path.join(appDataDir(), 'map-tiles');
}

/** The diagnostic logs, beside the data they describe. */
function logsDir() {
  const explicit = String(process.env.OMNI_LOG_DIR || '').trim();
  return explicit || path.join(appDataDir(), 'logs');
}

const written = new Set();

/** A pid is only dead when the system says so; a refused probe still means alive. */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

let swept = false;

/**
 * A launch killed outright never reaches the exit handler, so the scripts it
 * wrote are removed here the next time one is needed. Files belonging to a live
 * process are kept: two copies of the app can run at once.
 */
function sweepStaleScripts() {
  if (swept) return;
  swept = true;
  let entries = [];
  try {
    entries = fs.readdirSync(scratchDir());
  } catch {
    return;
  }
  for (const name of entries) {
    const match = /^omnicommander-(?:shortcut|recycle)-(\d+)\.ps1$/.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid || isRunning(pid)) continue;
    try {
      fs.rmSync(path.join(scratchDir(), name), { force: true });
    } catch {
      /* Still in use: the next launch tries again. */
    }
  }
}

/**
 * Path for a helper script this process owns. It carries the pid because two
 * copies of the app can run at once, and it is remembered so the exit handler
 * can take it away instead of leaving it behind.
 */
function scratchFile(name) {
  const dir = scratchDir();
  fs.mkdirSync(dir, { recursive: true });
  sweepStaleScripts();
  const file = path.join(dir, name);
  written.add(file);
  return file;
}

/** Removes every script this process wrote. Called once, from the exit handler. */
function cleanupScratch() {
  for (const file of written) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* Already gone or locked by a PowerShell that is still finishing. */
    }
  }
  written.clear();
}

process.once('exit', cleanupScratch);

module.exports = {
  appDataDir,
  mapTilesDir,
  scratchDir,
  scratchFile,
  cleanupScratch,
};
