/**
 * Linux trash support behind the platform contract.
 *
 * `gio trash` is the preferred path: it understands the desktop's trash
 * implementation and mount-local trash directories. When it is missing or
 * refuses a file, the fallback implements the freedesktop.org trash layout in
 * `$XDG_DATA_HOME/Trash`: the payload goes to `files/` and a companion
 * `.trashinfo` records the original absolute path and deletion date.
 *
 * The public surface is deliberately the one Windows already exposes:
 * `move(targets, { timeoutMs })`. Everything else, including name collision
 * handling and the `EXDEV` copy-then-delete path, stays inside this adapter.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const DEFAULT_TIMEOUT_MS = 300000;
const MAX_TRASH_NAME_ATTEMPTS = 1000;

function encodeTrashPath(value) {
  // The spec wants a URL-encoded path. Encoding each segment keeps the `/`
  // separators readable and still protects spaces, `#`, `%` and non-ASCII names.
  return value.split('/').map(encodeURIComponent).join('/');
}

function formatDeletionDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function trashInfoBody(target, date) {
  return `[Trash Info]\nPath=${encodeTrashPath(target)}\nDeletionDate=${formatDeletionDate(date)}\n`;
}

function xdgTrashRoot(env) {
  const configured = String(env.XDG_DATA_HOME || '').trim();
  if (configured && path.posix.isAbsolute(configured)) return path.posix.join(configured, 'Trash');
  return path.posix.join(os.homedir(), '.local', 'share', 'Trash');
}

function createLinuxTrash(options = {}) {
  const env = options.env || process.env;
  const fsApi = options.fs || fs;
  const execFileAsync = options.execFileAsync || promisify(execFile);
  const now = options.now || (() => new Date());
  const logDebug = options.logDebug || (() => {});
  let gioUnavailable = false;

  async function exists(target) {
    try {
      await fsApi.promises.lstat(target);
      return true;
    } catch {
      return false;
    }
  }

  async function movePath(source, destination) {
    try {
      await fsApi.promises.rename(source, destination);
      return;
    } catch (error) {
      // The home trash can live on another filesystem than the deleted file.
      // Copy first and remove the source only after the whole tree landed, so a
      // failed copy leaves the original in place.
      if (error.code !== 'EXDEV') throw error;
      await fsApi.promises.cp(source, destination, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
      await fsApi.promises.rm(source, { recursive: true, force: false, maxRetries: 3 });
    }
  }

  /** Reserves the first unused `name`/`name.trashinfo` pair with an exclusive write. */
  async function reserveInfo(filesDir, infoDir, baseName, target) {
    const body = trashInfoBody(target, now());
    for (let attempt = 1; attempt <= MAX_TRASH_NAME_ATTEMPTS; attempt += 1) {
      const name = attempt === 1 ? baseName : `${baseName}.${attempt}`;
      const payload = path.posix.join(filesDir, name);
      const info = path.posix.join(infoDir, `${name}.trashinfo`);
      if (await exists(payload)) continue;
      try {
        await fsApi.promises.writeFile(info, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return { name, payload, info };
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
    }
    throw new Error(`Could not find a free trash name for ${baseName}`);
  }

  async function moveToXdg(target) {
    const source = path.posix.normalize(target);
    if (!path.posix.isAbsolute(source)) throw new Error(`Unsafe trash path: ${target}`);
    const baseName = path.posix.basename(source);
    if (!baseName || baseName === '/' || baseName === '.' || baseName === '..') {
      throw new Error(`Refusing to trash a filesystem root: ${source}`);
    }

    const root = xdgTrashRoot(env);
    const filesDir = path.posix.join(root, 'files');
    const infoDir = path.posix.join(root, 'info');
    await fsApi.promises.mkdir(filesDir, { recursive: true, mode: 0o700 });
    await fsApi.promises.mkdir(infoDir, { recursive: true, mode: 0o700 });

    const reserved = await reserveInfo(filesDir, infoDir, baseName, source);
    try {
      await movePath(source, reserved.payload);
    } catch (error) {
      // The info file must not outlive a failed move: the next trash listing
      // would otherwise advertise an entry that is not in `files/`.
      await fsApi.promises.rm(reserved.info, { force: true }).catch(() => {});
      throw error;
    }
    logDebug('trash-moved', source, reserved.payload);
  }

  async function move(targets, moveOptions = {}) {
    if (!Array.isArray(targets)) throw new TypeError('trash.move needs an array of paths');
    const pending = targets.map((target) => path.posix.normalize(String(target || '').trim()));
    if (pending.length === 0) return;
    for (const target of pending) {
      if (!path.posix.isAbsolute(target)) throw new Error(`Unsafe trash path: ${target}`);
    }

    const timeoutMs = moveOptions.timeoutMs || DEFAULT_TIMEOUT_MS;
    if (!gioUnavailable) {
      try {
        await execFileAsync('gio', ['trash', ...pending], {
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
        });
        return;
      } catch (error) {
        if (error && error.code === 'ENOENT') gioUnavailable = true;
        logDebug('trash-gio-failed', error && error.message ? error.message : String(error));
      }
    }

    // `gio` can move some targets before returning an error. Re-check each one
    // and only fall back for the paths that are still on disk.
    const remaining = [];
    for (const target of pending) {
      if (await exists(target)) remaining.push(target);
    }
    if (remaining.length === 0) return;

    for (const target of remaining) await moveToXdg(target);
  }

  return Object.freeze({ move });
}

module.exports = { createLinuxTrash, encodeTrashPath, formatDeletionDate };
