const { contextBridge, ipcRenderer } = require('electron');

// The embedded API server takes the first free port (3001 may belong to another
// app), and the main process hands that number down through argv so the renderer
// can address it without guessing.
const apiPortArgument = process.argv.find((argument) => argument.startsWith('--omni-api-port='));
const parsedApiPort = apiPortArgument ? Number(apiPortArgument.slice('--omni-api-port='.length)) : NaN;

// The per-launch session token travels down the same argv channel as the port.
// The renderer attaches it as the x-omni-token header on every request, which
// the server requires for any mutation.
const apiTokenArgument = process.argv.find((argument) => argument.startsWith('--omni-api-token='));
const apiToken = apiTokenArgument ? apiTokenArgument.slice('--omni-api-token='.length) : '';

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  relaunchAsAdmin: () => ipcRenderer.invoke('app:relaunch-admin'),
  // Tray bridge: the renderer reports what is running, and receives
  // pause/resume/cancel when the user picks one of those from the tray menu.
  updateTrayState: (state) => ipcRenderer.send('tray:state', state),
  onTrayCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('tray:command', listener);
    return () => ipcRenderer.removeListener('tray:command', listener);
  },
  // Native picker for paths that exist outside the panels. The title comes from
  // the renderer so the dialog speaks the app's current language.
  pickPaths: (mode, title) => ipcRenderer.invoke('dialog:pick-paths', { mode, title }),
  // Updates are decided in the main process, which owns the privileged file
  // system and the network. The renderer can only ask for a check, accept the
  // download it is offered, and request the restart after it is ready.
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  isElectron: true,
  apiPort: Number.isFinite(parsedApiPort) && parsedApiPort > 0 ? parsedApiPort : 3001,
  apiToken,
});
