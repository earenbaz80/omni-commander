const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
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
  serverApi.onPortReady(port => {
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
    return new Promise(resolve => setTimeout(() => resolve(apiPort), 1500));
  }
  return new Promise(resolve => {
    serverApi.onPortReady(resolve);
    setTimeout(() => resolve(apiPort), 4000);
  });
}

const isDev = !app.isPackaged;

let mainWindow;

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());

// Explorer carries an elevated token for protected destinations, so a file
// manager that never elevates looks broken on the very same folder. Relaunching
// through ShellExecute's RunAs verb is the only way to gain that token from a
// non-elevated process; Windows shows the consent prompt itself.
ipcMain.handle('app:relaunch-admin', () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  // Single quotes inside a PowerShell single-quoted literal are doubled.
  const exePath = process.execPath.replace(/'/g, "''");
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', `Start-Process -FilePath '${exePath}' -Verb RunAs`],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'spawn failed' };
  }
  // The elevated instance starts its own file server, so this one steps aside
  // instead of leaving two windows competing over the same jobs.
  setTimeout(() => app.quit(), 400);
  return { ok: true };
});