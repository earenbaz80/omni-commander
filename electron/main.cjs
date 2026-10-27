const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

// Per-launch session token. It is the shared secret between this process, the
// embedded API server and the renderer: every mutating request must carry it,
// so a remote web page (which cannot know it) can never drive the loopback API
// -- not even with an opaque `Origin: null` sandboxed iframe. It lives only in
// this process's memory and never touches disk or the network.
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
  // on its two legitimate local origins. Denying navigation and window.open
  // keeps a compromised renderer from turning the shell into a browser.
  const isAllowedLocalUrl = (target) => {
    if (!target) return false;
    if (isDev && target.startsWith('http://localhost:3000')) return true;
    return target.startsWith('file://');
  };
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
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  await whenApiPortReady();
  createMainWindow();
  createTray();
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
