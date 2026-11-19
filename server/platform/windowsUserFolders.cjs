/**
 * The folders Windows presents as libraries, resolved for the signed-in profile.
 *
 * Desktop and Documents are frequently redirected into OneDrive, so a path
 * built from `%USERPROFILE%` is wrong there and a failed lookup must fall back
 * rather than report a folder that does not exist. Both halves moved here from
 * `fileOps` when the renderer stopped being served Windows libraries on other
 * platforms: the adapter answers the question, and the server only asks for the
 * capability.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const WIN32 = path.win32;

/**
 * The five folders Explorer shows as libraries: id used by the renderer, and the
 * .NET SpecialFolder name that resolves it.
 */
const USER_LIBRARY_FOLDERS = [
  ['desktop', 'Desktop'],
  ['documents', 'MyDocuments'],
  ['pictures', 'MyPictures'],
  ['music', 'MyMusic'],
  ['videos', 'MyVideos'],
  // .NET has no SpecialFolder for Downloads: it is only ever the profile one.
  ['downloads', null],
];

/** The profile's own folder names, which is all that is left when the lookup fails. */
function guessedUserFolders(profile) {
  // Without an absolute profile the names would be relative, and a relative
  // "Desktop" resolves against wherever the server happens to run.
  if (!profile || !WIN32.isAbsolute(profile)) return {};
  return {
    desktop: WIN32.join(profile, 'Desktop'),
    documents: WIN32.join(profile, 'Documents'),
    pictures: WIN32.join(profile, 'Pictures'),
    music: WIN32.join(profile, 'Music'),
    videos: WIN32.join(profile, 'Videos'),
    downloads: WIN32.join(profile, 'Downloads'),
  };
}

function createWindowsUserFolders(options = {}) {
  const fsApi = options.fs || fs;
  const env = options.env || process.env;
  const execFileAsync = options.execFileAsync || promisify(execFile);
  const powershellTimeoutMs = options.powershellTimeoutMs || 60000;

  /** The redirected folders, as the profile itself reports them. */
  async function readSpecialFolders() {
    try {
      const body = USER_LIBRARY_FOLDERS.filter(([, special]) => special)
        .map(([key, special]) => `${key} = [Environment]::GetFolderPath('${special}')`)
        .join('; ');
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `@{ ${body} } | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: powershellTimeoutMs },
      );
      return JSON.parse(String(stdout || '').trim() || '{}');
    } catch {
      // A failed lookup is not a machine without folders: fall back to the profile.
      return {};
    }
  }

  /**
   * Every library folder this machine has. Each candidate is checked against the
   * disk before it is reported, so the tree never offers a folder that would
   * fail to open.
   */
  async function list() {
    const resolved = await readSpecialFolders();
    const guessed = guessedUserFolders(String(env.USERPROFILE || '').trim());
    return USER_LIBRARY_FOLDERS.map(([key]) => ({
      key,
      path: String(resolved[key] || guessed[key] || ''),
    })).filter((entry) => entry.path && fsApi.existsSync(entry.path));
  }

  return Object.freeze({ list });
}

module.exports = { createWindowsUserFolders };
