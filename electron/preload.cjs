const { contextBridge, ipcRenderer } = require('electron');

// The embedded API server takes the first free port (3001 may belong to another
// app), and the main process hands that number down through argv so the renderer
// can address it without guessing.
const apiPortArgument = process.argv.find(argument => argument.startsWith('--omni-api-port='));
const parsedApiPort = apiPortArgument
  ? Number(apiPortArgument.slice('--omni-api-port='.length))
  : NaN;

// The per-launch session token travels down the same argv channel as the port.
// The renderer attaches it as the x-omni-token header on every request, which
// the server requires for any mutation.
const apiTokenArgument = process.argv.find(argument => argument.startsWith('--omni-api-token='));
const apiToken = apiTokenArgument ? apiTokenArgument.slice('--omni-api-token='.length) : '';

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  relaunchAsAdmin: () => ipcRenderer.invoke('app:relaunch-admin'),
  isElectron: true,
  apiPort: Number.isFinite(parsedApiPort) && parsedApiPort > 0 ? parsedApiPort : 3001,
  apiToken,
});