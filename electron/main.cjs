const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { launchElevated } = require('./elevation.cjs');
const { appendLogSync } = require('../server/scratch.cjs');
const crypto = require('node:crypto');
const { isAllowedNavigationUrl } = require('./navigationGuard.cjs');
const { isAllowedExternalTarget } = require('./externalLinks.cjs');
const { denyAllPermissions } = require('./permissions.cjs');
const { normalizeChannel, readUpdateChannel } = require('./updateChannel.cjs');
const { nextStateForOffer } = require('./updateOffer.cjs');
const { canReloadRenderer, rendererGoneLine } = require('./rendererRecovery.cjs');
const { isTransientUpdateError, nextRetryDelay } = require('./updateRetry.cjs');

// Per-launch session token. It is the shared secret between this process, the
// embedded API server and the renderer: every mutating request, and every GET
// that describes the disk, must carry it, so a remote web page (which cannot
// know it) can never drive the loopback API -- not even with an opaque
// `Origin: null` sandboxed iframe. It lives only in this process's memory and
// never touches disk or the network.
const sessionToken = crypto.randomBytes(32).toString('hex');

// The server reads this from process.env at require time (the same channel it
// uses to announce its port through OMNI_API_PORT), so it must be set before
// server.cjs is loaded.
process.env.OMNI_SESSION_TOKEN = sessionToken;
// The map's offline cache belongs beside the app's other data, not in the
// temporary folder: an area saved before a flight has to survive a reboot.
process.env.OMNI_MAP_CACHE_DIR = path.join(app.getPath('userData'), 'map-tiles');
// The diagnostic logs belong with the rest of the app's data too, and the server
// reads this at require time like the two above.
process.env.OMNI_LOG_DIR = path.join(app.getPath('userData'), 'logs');

// Start the local real-drive API inside Electron so the packaged app is standalone.
// The server never crashes on a busy port: it walks forward to the first free one,
// so we must learn which port it actually bound before the renderer can talk to it.
let apiPort = null;
let serverApi = null;
try {
  // server.cjs only uses dependencies already included in the app package.
  serverApi = require(path.join(__dirname, '..', 'server.cjs'));
  serverApi.onPortReady((port) => {
    apiPort = port;
  });
} catch (error) {
  console.error('Unable to start local drive server:', error);
}

/**
 * Resolves with the bound API port, or null when the server could not start.
 * The timeout keeps a dead server from blocking window creation forever.
 */
function whenApiPortReady() {
  if (apiPort != null) return Promise.resolve(apiPort);
  if (!serverApi || typeof serverApi.onPortReady !== 'function') {
    return new Promise((resolve) => setTimeout(() => resolve(apiPort), 1500));
  }
  return new Promise((resolve) => {
    serverApi.onPortReady(resolve);
    setTimeout(() => resolve(apiPort), 4000);
  });
}

const isDev = !app.isPackaged;

let mainWindow;
// Renderer deaths since the last load that managed to finish: a window that
// dies on every load must not be reloaded forever.
let rendererCrashes = 0;

// ---------------------------------------------------------------------------
// Updates
//
// The packaged NSIS build carries the `app-update.yml` electron-builder writes,
// so the updater reads the same `latest.yml` the release pipeline publishes and
// verifies. Nothing here runs in development: there is no such file next to a
// dev build, and a check would only add noise. A portable build unpacks itself
// into a temporary folder on every launch, so it has no installed copy to
// replace and is left out too.
// ---------------------------------------------------------------------------

const UPDATE_FIRST_CHECK_DELAY_MS = 8000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STATUSES = new Set(['idle', 'checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error']);

/** The bounded snapshot the interface is allowed to know about the updater. */
let updateState = {
  status: 'idle',
  version: null,
  percent: 0,
  error: null,
  // Whether the updater exists at all: development builds and the portable one
  // have no installed copy to replace, so the interface hides the controls
  // instead of offering something that cannot work.
  enabled: false,
  // `stable` or `beta`. A beta build is offered only after the user opts in:
  // test versions are published as GitHub prereleases, which the stable feed
  // never reads.
  channel: 'stable',
};
let updater = null;
// Checks that failed against a GitHub 5xx, and the timer that repeats one.
let updateRetryAttempt = 0;
let updateRetryTimer = null;

function isUpdaterSupported() {
  return !isDev && !process.env.PORTABLE_EXECUTABLE_FILE;
}

function pushUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update:state', updateState);
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  pushUpdateState();
}

/** Only the window that hosts the app may drive the updater. */
function isFromAppWindow(event) {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

/**
 * Where the chosen channel is kept. Its own one-line file beside the token, for
 * the same reason: the main process reads it at startup, before any renderer
 * exists to say what was chosen.
 */
function updateChannelPath() {
  return path.join(app.getPath('userData'), 'update-channel');
}

/**
 * Applies the channel to the live updater. `allowPrerelease` is what makes the
 * library look at the prerelease list instead of `/releases/latest`; without it,
 * a beta is simply invisible. Called at start and whenever the setting changes,
 * because a switch must take effect without a restart.
 */
function applyUpdateChannel() {
  const channel = readUpdateChannel({
    channelPath: updateChannelPath(),
    readFile: (file) => fs.readFileSync(file, 'utf8'),
  });
  if (updater) updater.allowPrerelease = channel === 'beta';
  updateState = { ...updateState, channel };
  return channel;
}

/**
 * Starts a check without letting it escape: rejections arrive through the error
 * event, and a failure thrown before the provider exists never becomes a
 * rejection, so both are handled here.
 */
function checkNow() {
  if (!updater) return;
  try {
    updater.checkForUpdates()?.catch(() => {});
  } catch (error) {
    reportUpdateError(error);
  }
}

function cancelUpdateRetry() {
  if (!updateRetryTimer) return;
  clearTimeout(updateRetryTimer);
  updateRetryTimer = null;
}

/** A check that worked, or one the user asked for, starts the ladder over. */
function resetUpdateRetry() {
  updateRetryAttempt = 0;
  cancelUpdateRetry();
}

/**
 * A 5xx is GitHub having a bad half hour, and copying it into the interface
 * until the six-hour timer looks the same as a broken feed. Repeat the check
 * here instead, backing off, and leave every other failure alone: a 404 is our
 * own manifest being wrong and an offline machine has nothing to ask.
 */
function scheduleUpdateRetry(message) {
  if (!isTransientUpdateError(message)) return;
  const delay = nextRetryDelay(updateRetryAttempt);
  if (delay === null) return;
  updateRetryAttempt += 1;
  cancelUpdateRetry();
  console.log(`Update check failed with a server error; retrying in ${Math.round(delay / 1000)}s`);
  updateRetryTimer = setTimeout(checkNow, delay);
  // The wait must not be what keeps the process alive.
  updateRetryTimer.unref?.();
}

function reportUpdateError(error) {
  const message = String(error?.message ?? error);
  // Offline machines are normal for this app, so a failed check is a state to
  // display, never something that interrupts the session.
  console.error('Update error:', error);
  setUpdateState({ status: 'error', error: message });
  scheduleUpdateRetry(message);
}

function setupUpdater() {
  if (!isUpdaterSupported()) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    // A missing updater is a degraded app, not a broken one: everything else
    // keeps working and the interface simply never offers an update.
    console.error('Updater unavailable:', error);
    return;
  }

  // Fetching 100+ MB is the user's decision: the interface offers the button and
  // nothing is downloaded until it is pressed.
  autoUpdater.autoDownload = false;
  // Once downloaded, finishing the update on exit does not interrupt anything
  // and needs no extra click. The interface also offers an explicit restart.
  autoUpdater.autoInstallOnAppQuit = true;

  // The feed is the `app-update.yml` electron-builder wrote into the package,
  // which points at the public GitHub repository: the library reads it on its
  // own, with no credential involved. Only the channel is ours to apply, and it
  // must be in place before the first check.
  updater = autoUpdater;
  applyUpdateChannel();

  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  // A check that got as far as an answer ends the retry ladder.
  autoUpdater.on('update-available', () => resetUpdateRetry());
  autoUpdater.on('update-not-available', () => resetUpdateRetry());
  // A check can land on a version whose installer is already downloaded — the
  // timer eight seconds after launch, the one every six hours, or the button.
  // The decision keeps that restart instead of asking for the file again.
  autoUpdater.on('update-available', (info) => setUpdateState(nextStateForOffer(updateState, info)));
  autoUpdater.on('update-not-available', () =>
    setUpdateState({ status: 'up-to-date', version: null, percent: 0, error: null }),
  );
  autoUpdater.on('download-progress', (progress) =>
    setUpdateState({ status: 'downloading', percent: Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0))) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'downloaded', version: info?.version ?? updateState.version, percent: 100, error: null }),
  );
  autoUpdater.on('error', reportUpdateError);

  const firstCheck = setTimeout(checkNow, UPDATE_FIRST_CHECK_DELAY_MS);
  const periodicCheck = setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);
  // Neither timer may keep the process alive on its own.
  firstCheck.unref?.();
  periodicCheck.unref?.();

  // Only now can the interface offer anything: the updater is wired and the
  // feed is applied.
  setUpdateState({ enabled: true });
}

// ---------------------------------------------------------------------------
// Tray
//
// A transfer can outlive the window: closing it while a copy is still writing
// used to kill the renderer, and with it the only pause/cancel control. The tray
// keeps a live transfer reachable and is the way back to a hidden window.
//
// The renderer owns the truth about tasks, so this process mirrors a tiny,
// strictly bounded snapshot of it and forwards commands back over IPC. Nothing
// here reads the file system or blocks: a tray that lags a frame is harmless, a
// main process that waits is not.
// ---------------------------------------------------------------------------

const TRAY_LABEL_LIMIT = 32;
const TRAY_TITLE_LIMIT = 60;
const TRAY_TOOLTIP_LIMIT = 120;
const LIVE_STATUSES = ['running', 'paused', 'queued'];

let tray = null;
let trayMenu = null;
// Real quitting must be distinguishable from closing the window, otherwise the
// close handler below would hide the window during `app.quit()` and the process
// would never exit.
let quitting = false;
let trayState = {
  hasLiveWork: false,
  activeCount: 0,
  task: null,
  labels: {
    resume: 'Resume',
    pause: 'Pause',
    cancel: 'Cancel',
    quit: 'Quit',
  },
};

/** Cuts a string to a length that still fits a tray tooltip or a menu row. */
function clampText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * The renderer is the only writer, but it is still a web page: treat everything
 * it sends as untrusted input and rebuild a fresh object with known field types.
 */
function normalizeTrayState(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rawTask = source.task && typeof source.task === 'object' ? source.task : null;
  const status = rawTask && LIVE_STATUSES.includes(rawTask.status) ? rawTask.status : null;
  const task = status
    ? {
        id: clampText(rawTask.id, TRAY_TITLE_LIMIT),
        title: clampText(rawTask.title, TRAY_TITLE_LIMIT) || 'Transfer',
        status,
        progress: Number.isFinite(rawTask.progress) ? Math.min(100, Math.max(0, Math.round(rawTask.progress))) : 0,
      }
    : null;
  const rawCount = Number(source.activeCount);
  const activeCount = Number.isFinite(rawCount) ? Math.min(99, Math.max(0, Math.trunc(rawCount))) : task ? 1 : 0;
  const rawLabels = source.labels && typeof source.labels === 'object' ? source.labels : {};

  return {
    hasLiveWork: activeCount > 0 || !!task,
    activeCount,
    task,
    labels: {
      resume: clampText(rawLabels.resume, TRAY_LABEL_LIMIT) || 'Resume',
      pause: clampText(rawLabels.pause, TRAY_LABEL_LIMIT) || 'Pause',
      cancel: clampText(rawLabels.cancel, TRAY_LABEL_LIMIT) || 'Cancel',
      quit: clampText(rawLabels.quit, TRAY_LABEL_LIMIT) || 'Quit',
    },
  };
}

/**
 * The tray uses a 32px PNG derived from the installer icon: Windows scales it
 * down for the notification area at every display scale, and unlike an .ico it
 * can be read straight from the package bytes. Reading the bytes ourselves
 * matters because fs is asar-aware while nativeImage's path loader is not.
 */
function loadTrayIcon() {
  const file = path.join(__dirname, 'tray.png');
  try {
    const image = nativeImage.createFromBuffer(fs.readFileSync(file));
    if (!image.isEmpty()) return image;
  } catch (error) {
    console.error('Tray icon could not be read:', error);
  }
  return null;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendTrayCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('tray:command', command);
}

/**
 * Rebuilds the menu from the mirrored snapshot. Resume and Pause are mutually
 * exclusive so the menu always states what a click will actually do.
 */
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const { task, activeCount, labels } = trayState;
  const status = task ? task.status : null;
  const summary = task ? `${task.title}${task.progress > 0 ? ` — ${task.progress}%` : ''}` : '';

  tray.setToolTip(clampText(summary ? `OmniCommander Pro · ${summary}` : 'OmniCommander Pro', TRAY_TOOLTIP_LIMIT));

  const header = activeCount > 1 ? `OmniCommander Pro (${activeCount})` : 'OmniCommander Pro';
  trayMenu = Menu.buildFromTemplate([
    { label: header, click: showMainWindow },
    { type: 'separator' },
    { label: summary || '—', enabled: false },
    {
      label: labels.resume,
      enabled: status === 'paused',
      click: () => sendTrayCommand('resume'),
    },
    {
      label: labels.pause,
      enabled: status === 'running',
      click: () => sendTrayCommand('pause'),
    },
    {
      label: labels.cancel,
      enabled: status === 'running' || status === 'paused' || status === 'queued',
      click: () => sendTrayCommand('cancel'),
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);

  // Windows shows a context menu on left click as well when one is attached, and
  // a left click must restore the window instead. Right click owns the menu
  // there; other platforms attach it the usual way.
  if (process.platform === 'win32') tray.setContextMenu(null);
  else tray.setContextMenu(trayMenu);
}

function createTray() {
  if (tray) return;
  const icon = loadTrayIcon();
  if (!icon) {
    // A tray-less launch is degraded, not broken: transfers still work while the
    // window is open. Say so instead of failing the whole app.
    console.error('Tray icon not found; continuing without tray controls.');
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip('OmniCommander Pro');
  tray.on('click', showMainWindow);
  tray.on('right-click', () => {
    if (trayMenu) tray.popUpContextMenu(trayMenu);
  });
  refreshTrayMenu();
  console.log('Tray controls ready.');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    resizable: true,
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Hands the bound API port and the per-launch session token to
      // preload.cjs through argv, the same channel this process receives them.
      additionalArguments: [`--omni-api-port=${apiPort ?? ''}`, `--omni-api-token=${sessionToken}`],
    },
  });

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  // The product is offline by design, so the window is only ever allowed to stay
  // on its two legitimate local documents. Denying navigation and window.open
  // keeps a compromised renderer from turning the shell into a browser. The
  // comparison is by origin, and by the bundle's own folder for file URLs: see
  // navigationGuard.cjs for the two prefix holes that closed.
  const rendererRoot = path.join(__dirname, '..', 'dist');
  const isAllowedLocalUrl = (target) => isAllowedNavigationUrl(target, { isDev, distDir: rendererRoot });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedLocalUrl(target)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return isAllowedLocalUrl(url) ? { action: 'allow' } : { action: 'deny' };
  });

  // Closing the window while a transfer is live hides it instead of destroying
  // the renderer: the copy keeps writing, the tray keeps the controls, and the
  // header item brings the window back. With nothing running, close still exits.
  mainWindow.on('close', (event) => {
    if (quitting || !trayState.hasLiveWork) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // A renderer that dies leaves the shell running around a window that paints
  // nothing: the tray, the local API and any transfer in flight survive, so the
  // app looks hung instead of gone and nothing says why. Write the reason down
  // and rebuild the interface; a renderer that dies on every load is left alone.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const line = rendererGoneLine(details);
    console.error('Renderer gone:', line);
    try {
      appendLogSync('omnicommander-renderer.log', `${new Date().toISOString()} renderer gone ${line}`);
    } catch {
      // A log that cannot be written is no reason to keep the window dead.
    }
    if (!canReloadRenderer(rendererCrashes)) {
      console.error('Renderer gone again after reloads; leaving the window as it is.');
      return;
    }
    rendererCrashes += 1;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.reload();
  });

  // A load that finished means the interface came back, so the next death —
  // hours later, or after whatever caused it is gone — starts the count again.
  mainWindow.webContents.on('did-finish-load', () => {
    rendererCrashes = 0;
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(rendererRoot, 'index.html'));
  }
}

app.whenReady().then(async () => {
  await whenApiPortReady();
  // Before the window exists, so the renderer never gets a chance to ask: the
  // app needs no device permission at all (see permissions.cjs).
  denyAllPermissions(session.defaultSession);
  createMainWindow();
  createTray();
  // After the window exists, so a state pushed early still has somewhere to go.
  setupUpdater();
});

// A real quit must not be intercepted by the close-to-tray handler above.
app.on('before-quit', () => {
  quitting = true;
});

// Windows has no dock to bring the app back from, so closing every window ends it.
app.on('window-all-closed', () => {
  app.quit();
});

// The renderer pushes a bounded snapshot whenever a task starts, changes state
// or disappears of its own accord. Only the window that hosts the app may write
// it, so a stray frame or a devtools extra cannot take over the tray.
ipcMain.on('tray:state', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  trayState = normalizeTrayState(payload);
  refreshTrayMenu();
});

// The interface asks for the snapshot when it mounts: the first check starts
// before the renderer has subscribed, so an event alone would be missed.
ipcMain.handle('update:state', (event) => (isFromAppWindow(event) ? updateState : null));

ipcMain.handle('update:check', async (event) => {
  if (!isFromAppWindow(event) || !updater) return updateState;
  // The user asking is also the answer to a pending retry.
  resetUpdateRetry();
  try {
    await updater.checkForUpdates();
  } catch (error) {
    setUpdateState({ status: 'error', error: String(error?.message ?? error) });
  }
  return updateState;
});

// Switching channel is a preference, not a credential, so it is stored as one
// plain word. A change applies immediately and re-checks: otherwise the user
// would tick the box, see "up to date" from the previous feed, and conclude the
// switch did nothing.
ipcMain.handle('update:channel', (event, raw) => {
  if (!isFromAppWindow(event) || !updater) return updateState;
  const channel = normalizeChannel(raw);
  try {
    const file = updateChannelPath();
    if (channel === 'beta') fs.writeFileSync(file, `${channel}\n`, { mode: 0o600 });
    else fs.rmSync(file, { force: true });
  } catch (error) {
    console.error('Update channel could not be saved:', error?.message ?? error);
    return updateState;
  }
  applyUpdateChannel();
  // Any verdict from the previous channel is stale by definition.
  setUpdateState({ status: 'idle', version: null, percent: 0, error: null });
  checkNow();
  return updateState;
});

ipcMain.handle('update:download', async (event) => {
  if (!isFromAppWindow(event) || !updater) return updateState;
  // Only an offered update may be fetched; a stale click does nothing.
  if (updateState.status !== 'available') return updateState;
  resetUpdateRetry();
  try {
    await updater.downloadUpdate();
  } catch (error) {
    setUpdateState({ status: 'error', error: String(error?.message ?? error) });
  }
  return updateState;
});

ipcMain.handle('update:install', (event) => {
  if (!isFromAppWindow(event) || !updater) return false;
  if (updateState.status !== 'downloaded') return false;
  // A real quit must not be turned into "hide to tray" by the close handler.
  quitting = true;
  // Silent on purpose. The assistant left a wizard open between the app closing
  // and the same program reopening, and its last page still wanted a click: on
  // a machine nobody is watching, that is an app left half updated. The second
  // argument stays true because the user asked for an update, not to come back
  // to the app closed.
  updater.quitAndInstall(true, true);
  return true;
});

// The renderer cannot navigate out of its document nor open windows, so a link
// that must leave the app asks here instead: an allowlisted page opens, and any
// other URL is refused rather than handed to the shell.
ipcMain.handle('app:open-external', async (event, target) => {
  if (!isFromAppWindow(event) || !isAllowedExternalTarget(target)) return false;
  await shell.openExternal(target);
  return true;
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());

// Adds entries to an open transfer list from outside the panels. A sandboxed
// renderer cannot see arbitrary folders, so the picker runs here and only hands
// back the paths; sizing and validation stay behind the server's API.
// Windows cannot mix files and folders in one dialog, so the mode picks one.
ipcMain.handle('dialog:pick-paths', async (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return [];
  const mode = payload?.mode === 'folders' ? 'folders' : 'files';
  const title = typeof payload?.title === 'string' ? payload.title.slice(0, 120) : undefined;
  const folders = mode === 'folders';
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: folders ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

// Explorer carries an elevated token for protected destinations, so a file
// manager that never elevates looks broken on the very same folder. Relaunching
// through ShellExecute's RunAs verb is the only way to gain that token from a
// non-elevated process; Windows shows the consent prompt itself.
ipcMain.handle('app:relaunch-admin', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  // A portable build runs from a temporary extraction that the wrapper deletes
  // as soon as this process exits, so relaunching `process.execPath` would point
  // at a folder that is gone moments later and the new window never appears.
  // electron-builder exports the original portable file for exactly this case.
  const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  // Single quotes inside a PowerShell single-quoted literal are doubled.
  const exePath = target.replace(/'/g, "''");
  // The relaunch happens in a separate process after this one exits, so any
  // failure there is invisible. Record what was attempted and how it ended, in
  // the app's own log folder, and write it before returning: the elevated helper
  // reports its outcome into this same file and the reply is read back from it.
  const log = (message) => appendLogSync('omnicommander-relaunch.log', `${new Date().toISOString()} ${message}`);
  log(
    `request target=${target} portable=${process.env.PORTABLE_EXECUTABLE_FILE || 'unset'} execPath=${process.execPath}`,
  );
  try {
    // The elevated copy re-extracts and then launches, so let this process exit
    // first: starting both at once leaves two instances competing over the same
    // extraction folder, and the surviving window is the one that gets killed.
    // The launcher reports its outcome back into the log, and this process now
    // stays alive until that line arrives. That is what makes the relaunch
    // reliable: the previous version quit after 900ms while the launcher was
    // still waiting to start the elevated copy, so the helper was torn down with
    // us and no window ever appeared. Staying alive also keeps this window on
    // screen while the consent prompt is open, instead of vanishing behind it.
    // The launcher runs from a script file called by absolute path. Passing a
    // multi-line `-Command` string is fragile, and resolving `powershell.exe`
    // through PATH can fail inside a packaged app: both cases left nothing in
    // the log, which is exactly what a dead button looks like.
    // electron-builder ships its own elevation helper next to the app resources.
    // It opens the consent prompt and starts the target as administrator, which
    // is the same thing ShellExecute's RunAs verb does, without depending on
    // PowerShell being reachable or on a script surviving the trip through
    // `-Command`/`-File`. The PowerShell route left nothing in the log, which is
    // exactly what a dead button looks like.
    const elevatePath = path.join(process.resourcesPath || '', 'elevate.exe');
    if (!fs.existsSync(elevatePath)) {
      log(`elevate missing at ${elevatePath}`);
      return { ok: false, reason: 'elevate-missing' };
    }

    // The helper waits for the UAC prompt to be answered and then reports the
    // real outcome: zero means the elevated copy was started, anything else
    // means it was not. A timer cannot stand in for that answer -- the old
    // four-second "ok" quit this window while the prompt was still open, so
    // cancelling looked like a successful restart and no reason was shown.
    const result = await launchElevated({ elevatePath, target, log });

    log(`outcome=${result.ok ? 'ok' : result.reason}`);
    if (!result.ok) return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'launch failed';
    log(`launch error ${message}`);
    return { ok: false, reason: message };
  }

  // The elevated instance starts its own file server, so this one steps aside
  // once the replacement is confirmed running.
  setTimeout(() => app.exit(0), 400);
  return { ok: true };
});
