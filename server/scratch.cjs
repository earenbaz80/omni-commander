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

/** Size a log may reach before it is rolled over; one previous file is kept. */
const LOG_LIMIT_BYTES = 1024 * 1024;

/** Bytes written per log as this process knows them, so appending costs no stat. */
const logBytes = new Map();

function knownSize(file) {
  const remembered = logBytes.get(file);
  if (remembered !== undefined) return remembered;
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    size = 0;
  }
  logBytes.set(file, size);
  return size;
}

/**
 * Rolls the log over to `<name>.1`, replacing the previous one, so the newest
 * history is what a later read finds. A rename that fails leaves the count as it
 * was: the file keeps growing for that append and the next one tries again.
 */
function rotateLog(file) {
  const size = knownSize(file);
  try {
    fs.renameSync(file, `${file}.1`);
    logBytes.set(file, 0);
  } catch {
    logBytes.set(file, size);
  }
}

/** Path of a diagnostic log, for the writers and the route that reads one back. */
function logFile(name) {
  const dir = logsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* The append that follows reports the real problem. */
  }
  return path.join(dir, name);
}

/**
 * Appends one line to a diagnostic log, rotating it first when it is full.
 * Logging must never break what is being logged, so every failure here is
 * swallowed: a missing line is preferable to a refused transfer.
 */
function appendLogLine(name, line, sync) {
  const file = logFile(name);
  const payload = `${line}\n`;
  const bytes = Buffer.byteLength(payload);
  if (knownSize(file) + bytes > LOG_LIMIT_BYTES) rotateLog(file);
  logBytes.set(file, knownSize(file) + bytes);
  if (sync) {
    try {
      fs.appendFileSync(file, payload);
    } catch {
      /* See above. */
    }
    return;
  }
  fs.promises.appendFile(file, payload).catch(() => {});
}

/** Appends without blocking the caller; used where the write is pure diagnostics. */
function appendLog(name, line) {
  appendLogLine(name, line, false);
}

/**
 * Appends and returns only once the line is on disk. The relaunch path reads the
 * log back to learn how the new process ended, so its lines have to land first.
 */
function appendLogSync(name, line) {
  appendLogLine(name, line, true);
}

module.exports = {
  appDataDir,
  mapTilesDir,
  scratchDir,
  scratchFile,
  cleanupScratch,
  logsDir,
  logFile,
  appendLog,
  appendLogSync,
};
