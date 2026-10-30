const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { isAllowedNavigationUrl } = require('./navigationGuard.cjs');
const { isAllowedExternalTarget } = require('./externalLinks.cjs');
const { resolveUpdateFeed, normalizeToken, normalizeExpiry, readTokenExpiry } = require('./updateFeed.cjs');

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
  // Whether a credential was found is reported; the credential itself never
  // crosses the IPC boundary or reaches a log.
  tokenConfigured: false,
  tokenSource: null,
  tokenPath: null,
  // The day the credential stops working, when it was recorded. A fine-grained
  // token expires, and the settings warn before that becomes a failed check.
  tokenExpiresAt: null,
};
let updater = null;

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

/** Where a token saved from the interface is kept. */
function updateTokenPath() {
  return path.join(app.getPath('userData'), 'update-token');
}

/**
 * Where the token's expiry date is kept. It is a separate file so the credential
 * stays exactly what it was: a single line the resolver can read without having
 * to parse anything else.
 */
function updateTokenMetaPath() {
  return path.join(app.getPath('userData'), 'update-token-meta.json');
}

/**
 * Applies the feed -- target and credential -- to the live updater. Called at
 * start and again whenever the token changes, because `setFeedURL` replaces the
 * provider: saving a token in the settings applies it without a restart.
 */
function configureUpdateFeed() {
  if (!updater) return false;
  const tokenPath = updateTokenPath();
  let feed = null;
  try {
    feed = resolveUpdateFeed({
      appUpdateConfigPath: path.join(process.resourcesPath, 'app-update.yml'),
      env: process.env,
      tokenPath,
      readFile: (file) => fs.readFileSync(file, 'utf8'),
    });
    if (feed.options) updater.setFeedURL(feed.options);
  } catch (error) {
    // A provider the library rejects leaves the updater on whatever
    // `app-update.yml` says. That is a quieter app, not a broken one.
    console.error('Update feed unavailable:', error);
  }
  updateState = {
    ...updateState,
    tokenConfigured: feed?.token != null,
    tokenSource: feed?.tokenSource ?? null,
    tokenPath,
    tokenExpiresAt: readTokenExpiry({
      metaPath: updateTokenMetaPath(),
      readFile: (file) => fs.readFileSync(file, 'utf8'),
    }),
  };
  return updateState.tokenConfigured;
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
    setUpdateState({ status: 'error', error: String(error?.message ?? error) });
  }
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

  // The published repository is private, so the anonymous download URL the
  // library defaults to answers 404. The target comes from the `app-update.yml`
  // that electron-builder wrote into the package, and the token -- the user's,
  // never bundled -- from the machine. `setFeedURL` builds the provider
  // immediately, so this must happen before the first check.
  updater = autoUpdater;
  configureUpdateFeed();

  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) =>
    setUpdateState({ status: 'available', version: info?.version ?? null, percent: 0, error: null }),
  );
  autoUpdater.on('update-not-available', () =>
    setUpdateState({ status: 'up-to-date', version: null, percent: 0, error: null }),
  );
  autoUpdater.on('download-progress', (progress) =>
    setUpdateState({ status: 'downloading', percent: Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0))) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'downloaded', version: info?.version ?? updateState.version, percent: 100, error: null }),
  );
  autoUpdater.on('error', (error) => {
    // Offline machines are normal for this app, so a failed check is a state to
    // display, never something that interrupts the session.
    console.error('Update error:', error);
    setUpdateState({ status: 'error', error: String(error?.message ?? error) });
  });

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(rendererRoot, 'index.html'));
  }
}

app.whenReady().then(async () => {
  await whenApiPortReady();
  createMainWindow();
  createTray();
  // After the window exists, so a state pushed early still has somewhere to go.
  setupUpdater();
});

// A real quit must not be intercepted by the close-to-tray handler above.
app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  else showMainWindow();
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
  try {
    await updater.checkForUpdates();
  } catch (error) {
    setUpdateState({ status: 'error', error: String(error?.message ?? error) });
  }
  return updateState;
});

// Saving a token from the settings writes the same file the start-up reads, so
// the value lives on the machine and not in the renderer's storage. Only a
// usable value is written, and the reply says whether it was accepted without
// ever echoing it back.
ipcMain.handle('update:token', (event, raw) => {
  if (!isFromAppWindow(event) || !updater) return { ...updateState, accepted: false };

  const token = normalizeToken(raw);
  if (!token) return { ...updateState, accepted: false };

  try {
    const tokenPath = updateTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    // The recorded expiry belonged to the credential that was just replaced, so
    // it goes with it: a stale date would warn about the wrong token.
    fs.rmSync(updateTokenMetaPath(), { force: true });
  } catch (error) {
    // The value is never part of the message: a failed write must not leave the
    // credential in a log.
    console.error('Update token could not be saved:', error?.message ?? error);
    return { ...updateState, accepted: false };
  }

  configureUpdateFeed();
  setUpdateState({ status: 'idle', error: null });
  // The point of saving it is to stop failing: check right away.
  checkNow();
  return { ...updateState, accepted: true };
});

// The expiry date is a note about the credential, not a credential: it is kept
// in its own file so the token file stays a single line. Only a date the machine
// accepts is written, and the reply says whether it was, like the token's.
ipcMain.handle('update:token-expiry', (event, raw) => {
  if (!isFromAppWindow(event) || !updater) return { ...updateState, accepted: false };

  // Clearing the note is a null/empty value; a value that is not a real date is
  // refused instead of being stored as something the settings cannot read.
  const clearing = raw == null || raw === '';
  const expiry = clearing ? null : normalizeExpiry(raw);
  if (!clearing && !expiry) return { ...updateState, accepted: false };

  try {
    const metaPath = updateTokenMetaPath();
    if (expiry) {
      fs.mkdirSync(path.dirname(metaPath), { recursive: true });
      fs.writeFileSync(metaPath, `${JSON.stringify({ tokenExpiresAt: expiry })}\n`, { mode: 0o600 });
    } else {
      fs.rmSync(metaPath, { force: true });
    }
  } catch (error) {
    console.error('Update token expiry could not be saved:', error?.message ?? error);
    return { ...updateState, accepted: false };
  }

  setUpdateState({ tokenExpiresAt: expiry });
  return { ...updateState, accepted: true };
});

ipcMain.handle('update:token-clear', (event) => {
  if (!isFromAppWindow(event) || !updater) return updateState;
  try {
    fs.rmSync(updateTokenPath(), { force: true });
    fs.rmSync(updateTokenMetaPath(), { force: true });
  } catch (error) {
    console.error('Update token could not be removed:', error?.message ?? error);
  }
  configureUpdateFeed();
  setUpdateState({ status: 'idle', error: null });
  return updateState;
});

ipcMain.handle('update:download', async (event) => {
  if (!isFromAppWindow(event) || !updater) return updateState;
  // Only an offered update may be fetched; a stale click does nothing.
  if (updateState.status !== 'available') return updateState;
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
  updater.quitAndInstall(false, true);
  return true;
});

// The settings link to the GitHub page that creates the read-only token. The
// renderer cannot navigate out of its document nor open windows, so the link
// asks here instead: that page opens, and any other URL is refused rather than
// handed to the shell.
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
  // failure there is invisible. Record what was attempted and how it ended.
  const logPath = path.join(process.env.TEMP || '.', 'omnicommander-relaunch.log').replace(/'/g, "''");
  const log = (message) => {
    try {
      fs.appendFileSync(
        path.join(process.env.TEMP || '.', 'omnicommander-relaunch.log'),
        `${new Date().toISOString()} ${message}\n`,
      );
    } catch {
      /* logging must never break the relaunch */
    }
  };
  const file = path.join(process.env.TEMP || '.', 'omnicommander-relaunch.log');
  // Anything already in the log belongs to a previous attempt, so remember how
  // much text was there and only read what this attempt appends.
  let previousLog = '';
  try {
    previousLog = fs.readFileSync(file, 'utf8');
  } catch {
    previousLog = '';
  }
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
      return { ok: false, reason: 'elevate missing' };
    }

    // The helper may exit right after shelling out, or stay alive alongside the
    // app it started. Either way a non-zero exit means the launch was refused.
    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const child = spawn(elevatePath, [target], { stdio: 'ignore' });
      child.on('error', (error) => {
        log(`elevate spawn error ${error.message}`);
        finish('error');
      });
      child.on('exit', (code) => {
        log(`elevate exit ${code}`);
        finish(code === 0 ? 'ok' : 'error');
      });
      setTimeout(() => finish('ok'), 4000);
    });

    log(`outcome=${result}`);
    if (result !== 'ok') return { ok: false, reason: result };
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
