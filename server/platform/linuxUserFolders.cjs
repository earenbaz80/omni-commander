/**
 * The folders a Linux desktop puts first: the XDG user directories.
 *
 * `xdg-user-dirs` writes them to `$XDG_CONFIG_HOME/user-dirs.dirs` under the
 * names the locale chose, so on a Spanish install Desktop is `$HOME/Escritorio`
 * and Downloads is `$HOME/Descargas`. Reading that file is the only way to name
 * the folders the desktop actually shows; guessing English names, or reusing
 * the Windows library table, leaves the panel pointing at folders that are not
 * there.
 *
 * The keys stay the ones the renderer labels, so a library row means the same
 * thing on every platform.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Renderer key, and the variable `xdg-user-dirs` writes for it. */
const USER_FOLDER_KEYS = [
  ['desktop', 'XDG_DESKTOP_DIR'],
  ['documents', 'XDG_DOCUMENTS_DIR'],
  ['pictures', 'XDG_PICTURES_DIR'],
  ['music', 'XDG_MUSIC_DIR'],
  ['videos', 'XDG_VIDEOS_DIR'],
  // The variable is singular even though the folder is Downloads.
  ['downloads', 'XDG_DOWNLOAD_DIR'],
];

/** What `xdg-user-dirs` uses before the desktop writes a localized name. */
const DEFAULT_NAMES = {
  desktop: 'Desktop',
  documents: 'Documents',
  pictures: 'Pictures',
  music: 'Music',
  videos: 'Videos',
  downloads: 'Downloads',
};

/** Quotes are part of the file's syntax, not of the path. */
function unquote(value) {
  const text = String(value ?? '').trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * The file stores `$HOME/Escritorio` so the config survives a moved profile, and
 * the folder name itself may hold `$`; only a leading home reference expands.
 */
function expandHome(value, home) {
  const text = unquote(value);
  if (!text || !home) return text;
  if (text === '$HOME' || text === '${HOME}' || text === '~') return home;
  const prefix = /^(\$HOME|\$\{HOME\}|~)(?=\/)/.exec(text);
  return prefix ? path.posix.join(home, text.slice(prefix[0].length)) : text;
}

/** The assignments of `user-dirs.dirs`, with their home references resolved. */
function parseUserDirs(text, home) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    values[trimmed.slice(0, equals).trim()] = expandHome(trimmed.slice(equals + 1), home);
  }
  return values;
}

function createLinuxUserFolders(options = {}) {
  const fsApi = options.fs || fs;
  const env = options.env || process.env;
  const homeDir =
    options.home != null ? () => String(options.home).trim() : () => String(env.HOME || '').trim() || os.homedir();

  function configFile(home) {
    const root = String(env.XDG_CONFIG_HOME || '').trim() || path.posix.join(home, '.config');
    return path.posix.join(root, 'user-dirs.dirs');
  }

  async function readConfig(file) {
    try {
      return await fsApi.promises.readFile(file, 'utf8');
    } catch {
      // No file is a normal desktop rather than an error: the defaults apply.
      return '';
    }
  }

  async function isDirectory(target) {
    try {
      return (await fsApi.promises.stat(target)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * The user directories this machine has, in the order the panel shows them.
   * A folder that is not on disk is dropped, so the tree never offers a row that
   * would fail when clicked, and `xdg-user-dirs`' `""` (a disabled folder) is
   * not turned into the home directory.
   */
  async function list() {
    const home = homeDir();
    if (!home || !path.posix.isAbsolute(home)) return [];
    const values = parseUserDirs(await readConfig(configFile(home)), home);
    const folders = [];
    for (const [key, variable] of USER_FOLDER_KEYS) {
      const candidate = values[variable] || path.posix.join(home, DEFAULT_NAMES[key]);
      if (!candidate || !path.posix.isAbsolute(candidate)) continue;
      if (!(await isDirectory(candidate))) continue;
      folders.push({ key, path: candidate });
    }
    return folders;
  }

  return Object.freeze({ list });
}

module.exports = { createLinuxUserFolders };
