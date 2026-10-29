const path = require('node:path');

/**
 * Which paths the local API may touch.
 *
 * This is the first piece of the server to live on its own: it is a pair of pure
 * functions that every route asks before it reads or writes anything, so it can
 * be reasoned about and tested without starting the server. The rules are the
 * ones the single-file server grew, unchanged.
 */

// Only a drive-letter absolute path is local. UNC paths (`\\host\share`) and
// device paths (`\\?\`, `\\.\`) are deliberately excluded: reaching them would
// put the loopback-only, fully offline product on the network over SMB.
function isAbsoluteLocalPath(value) {
  const text = String(value || '').trim();
  // A bare drive letter ("C:") is how the panels address a drive root, and the
  // listing route already accepts it. Rejecting it here made every copy whose
  // destination was a drive root fail as an unsafe path while browsing the same
  // folder worked fine.
  return /^[a-zA-Z]:([\\/]|$)/.test(text);
}

// Reject anything that is not an absolute local path so a malformed or hostile
// request can never be resolved relative to the server's cwd.
function assertSafePath(value) {
  if (!isAbsoluteLocalPath(value)) throw new Error(`Unsafe path: ${value}`);
  const text = String(value).trim();
  // Normalize the drive-root form so downstream joins never see a bare "C:".
  const rooted = /^[a-zA-Z]:$/.test(text) ? `${text}\\` : text;
  return path.win32.normalize(rooted);
}

module.exports = { isAbsoluteLocalPath, assertSafePath };
