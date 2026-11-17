const fs = require('node:fs');
const path = require('node:path');

/**
 * Which paths the local API may touch.
 *
 * The rules are a platform policy, not a Windows constant: absolute paths,
 * comparison, volume roots and mount-root protection all depend on the target.
 * The named exports keep the process's policy for existing callers; a caller
 * that already knows its adapter can build its own with `createPathPolicy`.
 */

const PLATFORM_IDS = new Set(['win32', 'linux']);
const MOUNTS_FILE = '/proc/self/mounts';
const MOUNT_ROOTS_CACHE_MS = 1000;

function platformIdOf(platform) {
  const id = typeof platform === 'string' ? platform : platform && platform.id;
  if (!PLATFORM_IDS.has(id)) throw new Error(`Unsupported platform for path policy: ${String(id)}`);
  return id;
}

function decodeMountField(value) {
  return String(value).replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function normalizeRoot(value) {
  const text = String(value || '').trim();
  if (!path.posix.isAbsolute(text)) return '';
  const normalized = path.posix.normalize(text);
  return normalized !== '/' && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/** Mount points are the POSIX equivalent of a drive root. */
function readMountRoots() {
  const roots = new Set(['/']);
  let text = '';
  try {
    text = fs.readFileSync(MOUNTS_FILE, 'utf8');
  } catch {
    return roots;
  }
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2) continue;
    const root = normalizeRoot(decodeMountField(fields[1]));
    if (root) roots.add(root);
  }
  return roots;
}

function createPathPolicy(platform = process.platform, options = {}) {
  const id = platformIdOf(platform);
  const pathApi = id === 'win32' ? path.win32 : path.posix;
  const caseSensitive = id !== 'win32';
  const fixedRoots = Array.isArray(options.roots) ? new Set(['/']) : null;
  if (fixedRoots) {
    for (const root of options.roots) {
      const normalized = normalizeRoot(root);
      if (normalized) fixedRoots.add(normalized);
    }
  }
  const readRoots = options.readRoots || readMountRoots;
  let cachedRoots = { at: 0, roots: new Set(['/']) };

  function volumeRoots() {
    if (fixedRoots) return fixedRoots;
    const now = Date.now();
    if (now - cachedRoots.at >= MOUNT_ROOTS_CACHE_MS) {
      const roots = new Set(['/']);
      try {
        for (const value of readRoots()) {
          const normalized = normalizeRoot(value);
          if (normalized) roots.add(normalized);
        }
      } catch {
        // A missing or unreadable mount table still leaves the filesystem root.
      }
      cachedRoots = { at: now, roots };
    }
    return cachedRoots.roots;
  }

  function isAbsoluteLocalPath(value) {
    const text = String(value || '').trim();
    if (id === 'win32') {
      // Only a drive-letter absolute path is local. UNC paths (`\\host\share`)
      // and device paths (`\\?\`, `\\.\`) are deliberately excluded: reaching
      // them would put the loopback-only, fully offline product on SMB.
      return /^[a-zA-Z]:([\\/]|$)/.test(text);
    }
    // POSIX network shares are mounted into the local tree, so any absolute
    // POSIX path is local to this API. `//host/share` is not SMB on Linux; it
    // normalizes to `/host/share`.
    return path.posix.isAbsolute(text);
  }

  // Reject anything that is not an absolute local path so a malformed or hostile
  // request can never be resolved relative to the server's cwd.
  function assertSafePath(value) {
    if (!isAbsoluteLocalPath(value)) throw new Error(`Unsafe path: ${value}`);
    const text = String(value).trim();
    if (id === 'win32') {
      // Normalize the drive-root form so downstream joins never see a bare "C:".
      const rooted = /^[a-zA-Z]:$/.test(text) ? `${text}\\` : text;
      return path.win32.normalize(rooted);
    }
    return path.posix.normalize(text);
  }

  /** The normalized form used for comparisons, without a trailing separator. */
  function comparisonPath(value) {
    const normalized = assertSafePath(value);
    const root = pathApi.parse(normalized).root;
    return normalized.length > root.length && normalized.endsWith(pathApi.sep) ? normalized.slice(0, -1) : normalized;
  }

  // A volume root is how the panels address a whole disk: they open it and list
  // it, so the read routes must keep accepting it. Nothing may delete or move it
  // as a unit, which is a different question from whether the path is local.
  function isDriveRoot(value) {
    const text = String(value || '').trim();
    if (!isAbsoluteLocalPath(text)) return false;
    const normalized = assertSafePath(text);
    if (id === 'win32') return /^[a-zA-Z]:\\$/.test(normalized);
    return volumeRoots().has(comparisonPath(text));
  }

  // For the routes that destroy: a volume root passes the locality check but is
  // not a folder anyone may remove or move out of the way.
  function assertMutablePath(value) {
    if (isDriveRoot(value)) throw new Error(`Refusing to modify a drive root: ${value}`);
    return assertSafePath(value);
  }

  /** Path equality follows the filesystem: Windows folds case, POSIX does not. */
  function samePath(left, right) {
    const a = comparisonPath(left);
    const b = comparisonPath(right);
    return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
  }

  return Object.freeze({
    platform: id,
    pathApi,
    caseSensitive,
    isAbsoluteLocalPath,
    assertSafePath,
    isDriveRoot,
    assertMutablePath,
    samePath,
  });
}

const defaultPolicy = createPathPolicy(process.platform);

module.exports = {
  createPathPolicy,
  isAbsoluteLocalPath: defaultPolicy.isAbsoluteLocalPath,
  assertSafePath: defaultPolicy.assertSafePath,
  isDriveRoot: defaultPolicy.isDriveRoot,
  assertMutablePath: defaultPolicy.assertMutablePath,
  samePath: defaultPolicy.samePath,
};
