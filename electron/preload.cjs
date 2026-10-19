const { contextBridge, ipcRenderer } = require('electron');

// The embedded API server takes the first free port (3001 may belong to another
// app), and the main process hands that number down through argv so the renderer
// can address it without guessing.
const apiPortArgument = process.argv.find(argument => argument.startsWith('--omni-api-port='));
const parsedApiPort = apiPortArgument
  ? Number(apiPortArgument.slice('--omni-api-port='.length))
  : NaN;

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isElectron: true,
  apiPort: Number.isFinite(parsedApiPort) && parsedApiPort > 0 ? parsedApiPort : 3001,
});