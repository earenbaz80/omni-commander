const { app, BrowserWindow, ipcMain } = require('electron');
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
        `${new Date().toISOString()} ${message}\n`
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
    `request target=${target} portable=${process.env.PORTABLE_EXECUTABLE_FILE || 'unset'} execPath=${process.execPath}`
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
    const scriptPath = path.join(process.env.TEMP || '.', 'omnicommander-relaunch.ps1');
    const script = [
      'Start-Sleep -Milliseconds 600',
      'try {',
      `  Start-Process -FilePath '${exePath}' -Verb RunAs -ErrorAction Stop`,
      `  Add-Content -LiteralPath '${logPath}' -Value 'launch started'`,
      '} catch {',
      `  Add-Content -LiteralPath '${logPath}' -Value ("launch failed: " + $_.Exception.Message)`,
      '}'
    ].join('\r\n');
    fs.writeFileSync(scriptPath, script, 'utf8');
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', (error) => log(`helper spawn error ${error.message}`));
    child.on('exit', (code) => log(`helper exit ${code}`));
    child.unref();
    log('spawned relauncher');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'spawn failed';
    log(`spawn error ${message}`);
    return { ok: false, reason: message };
  }

  // Wait for the launcher to report back. A cancelled consent prompt or a
  // missing helper has to leave this window standing rather than closing it and
  // leaving nothing behind.
  const deadline = Date.now() + 120000;
  let outcome = 'timeout';
  while (Date.now() < deadline) {
    let current = '';
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch {
      current = '';
    }
    const fresh = current.slice(previousLog.length);
    if (fresh.includes('launch started')) {
      outcome = 'started';
      break;
    }
    const failure = fresh.match(/launch failed: .*/);
    if (failure) {
      outcome = 'failed';
      log(failure[0]);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log(`outcome=${outcome}`);
  if (outcome !== 'started') return { ok: false, reason: outcome };

  // The elevated instance starts its own file server, so this one steps aside
  // once the replacement is confirmed running.
  setTimeout(() => app.exit(0), 400);
  return { ok: true };
});