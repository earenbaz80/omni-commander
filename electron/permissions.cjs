/**
 * Device permissions for the window.
 *
 * The product needs none: the map asks the local server for a position instead
 * of using Chromium's geolocation, and nothing captures audio or video. Electron's
 * default is to ask, which in a frameless file manager is an unexplained
 * Chromium prompt with no product behind it. Denying every request and every
 * check keeps a compromised renderer from opening the camera, the microphone or
 * the clipboard, and makes the answer explicit instead of accidental.
 *
 * Split from main.cjs so the policy can be tested without launching Electron,
 * the same reason navigationGuard.cjs and externalLinks.cjs live on their own.
 */

/** Registers deny-all handlers on a session. Returns false if it cannot. */
function denyAllPermissions(session) {
  if (!session || typeof session.setPermissionRequestHandler !== 'function') return false;

  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  // The check handler is what runs against a permission a page already holds,
  // so leaving it out would let a cached grant outlive the request policy.
  if (typeof session.setPermissionCheckHandler === 'function') {
    session.setPermissionCheckHandler(() => false);
  }

  return true;
}

module.exports = { denyAllPermissions };
