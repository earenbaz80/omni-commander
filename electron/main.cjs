const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

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
      // Hands the bound API port to preload.cjs through argv.
      additionalArguments: [`--omni-api-port=${apiPort ?? ''}`],
    },
  });

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

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