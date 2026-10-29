const path = require('node:path');
const { fileURLToPath } = require('node:url');

/**
 * Which documents the privileged window may show.
 *
 * This lives apart from main.cjs so it can be tested without launching
 * Electron: the window runs with the preload bridge, which hands out the
 * per-launch session token, so anything else loaded there could drive the local
 * API. Two openings had to be closed, and both came from comparing strings:
 *
 * - `startsWith('http://localhost:3000')` accepts `http://localhost:3000@evil.com`,
 *   where `localhost:3000` is only the user name and the host is `evil.com`.
 *   The origin is the part that identifies a server, so that is what is compared.
 * - `startsWith('file://')` accepts any file on the machine, and also
 *   `file://share/document.html`, which on Windows is another machine's share --
 *   a network resource let into the window that is supposed to be offline. Only
 *   files inside the packaged renderer's own directory are served from disk.
 */

/** The dev UI is served here; the packaged renderer is loaded from `dist` over file://. */
const DEV_UI_ORIGIN = 'http://localhost:3000';

/** Windows compares paths without case, and the drive letter can arrive in either one. */
const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

/**
 * True only for the app's own document: the dev server's origin, or a file that
 * lives inside the packaged renderer directory.
 */
function isAllowedNavigationUrl(target, { isDev, distDir } = {}) {
  if (typeof target !== 'string' || target === '') return false;

  let url;
  try {
    url = new URL(target);
  } catch {
    // A relative or malformed target is not a document this window may show.
    return false;
  }

  if (isDev && url.origin === DEV_UI_ORIGIN) return true;

  // Everything else is either in the bundle on disk or refused.
  if (url.protocol !== 'file:') return false;
  // `file://host/share/x` names a remote share; a host can only be the machine itself.
  if (url.host !== '' && url.host !== 'localhost') return false;
  if (!distDir) return false;

  let filePath;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return false;
  }

  const root = fold(path.resolve(distDir));
  const resolved = fold(path.resolve(filePath));
  const relative = path.relative(root, resolved);
  // Inside the folder, and not the folder itself: a directory is not a document.
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = { DEV_UI_ORIGIN, isAllowedNavigationUrl };
