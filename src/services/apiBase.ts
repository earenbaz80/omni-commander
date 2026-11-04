/**
 * Base URL of the embedded local drive server.
 *
 * In the packaged Electron app the renderer is loaded from file://, so relative
 * /api/* requests never reach the embedded server. Resolve against the local
 * server's absolute URL there; keep relative paths in dev/web mode where Vite
 * proxies /api to http://127.0.0.1:3001.
 *
 * The port is NOT assumed: the embedded server takes the first free port (3001
 * is frequently held by unrelated software) and the main process passes the one
 * it actually bound through the preload bridge.
 *
 * It lives in its own module so the archive bridge can build request URLs
 * without importing the whole filesystem engine (and without an import cycle).
 */
export const API_BASE = (() => {
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!bridge?.isElectron) return '';
  const port = Number(bridge.apiPort);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 3001}`;
})();
