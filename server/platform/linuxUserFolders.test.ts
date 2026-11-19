// @vitest-environment node
import { describe, expect, it } from 'vitest';

/**
 * Quick Access on Linux has to name the folders the desktop itself shows. The
 * resolution reads `xdg-user-dirs`' file, which stores `$HOME/Escritorio` on a
 * Spanish install, so the adapter is driven here with an injected disk: the
 * suites that run on Windows still cover the logic that only runs on Linux.
 */

const { createLinuxUserFolders } = require('./linuxUserFolders.cjs');

const HOME = '/home/ana';

interface FakeDisk {
  files: Record<string, string>;
  folders: string[];
}

/** A disk holding only these files and folders; anything else is ENOENT. */
function fakeFs(disk: FakeDisk) {
  return {
    promises: {
      async readFile(file: string) {
        if (!(file in disk.files)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
        return disk.files[file];
      },
      async stat(file: string) {
        if (!disk.folders.includes(file)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
        return { isDirectory: () => true };
      },
    },
  };
}

const configAt = (root: string) => `${root}/user-dirs.dirs`;

describe('Linux user folders', () => {
  it('resolves the localized names the desktop wrote, dropping the ones this machine lacks', async () => {
    const config = [
      '# Written by xdg-user-dirs-update',
      'XDG_DESKTOP_DIR="$HOME/Escritorio"',
      'XDG_DOCUMENTS_DIR="$HOME/Documentos"',
      'XDG_PICTURES_DIR="${HOME}/Imágenes"',
      'XDG_MUSIC_DIR="$HOME/Música"',
      'XDG_DOWNLOAD_DIR="/srv/datos/Descargas"',
    ].join('\n');
    const adapter = createLinuxUserFolders({
      env: { HOME, XDG_CONFIG_HOME: '/srv/config' },
      fs: fakeFs({
        files: { [configAt('/srv/config')]: config },
        // Música is configured but not on disk, so it must not be offered.
        folders: [`${HOME}/Escritorio`, `${HOME}/Documentos`, `${HOME}/Imágenes`, '/srv/datos/Descargas'],
      }),
    });

    await expect(adapter.list()).resolves.toEqual([
      { key: 'desktop', path: `${HOME}/Escritorio` },
      { key: 'documents', path: `${HOME}/Documentos` },
      { key: 'pictures', path: `${HOME}/Imágenes` },
      { key: 'downloads', path: '/srv/datos/Descargas' },
    ]);
  });

  it('falls back to the names xdg-user-dirs uses before the desktop names them', async () => {
    const adapter = createLinuxUserFolders({
      env: { HOME },
      fs: fakeFs({
        files: {},
        folders: [`${HOME}/Documents`, `${HOME}/Downloads`],
      }),
    });

    await expect(adapter.list()).resolves.toEqual([
      { key: 'documents', path: `${HOME}/Documents` },
      { key: 'downloads', path: `${HOME}/Downloads` },
    ]);
  });

  it('never turns a disabled or relative folder into a row', async () => {
    const adapter = createLinuxUserFolders({
      env: { HOME },
      fs: fakeFs({
        files: {
          [`${HOME}/.config/user-dirs.dirs`]: [
            'XDG_DESKTOP_DIR=""',
            'XDG_MUSIC_DIR="Música"',
            'XDG_VIDEOS_DIR="$HOME/Vídeos"',
          ].join('\n'),
        },
        // The home directory exists, which is what an empty value used to point at.
        folders: [HOME, `${HOME}/Música`, `${HOME}/Vídeos`],
      }),
    });

    // A disabled folder is not the home directory, and a relative name is not a
    // folder the panel can open; the one real path still comes through.
    await expect(adapter.list()).resolves.toEqual([{ key: 'videos', path: `${HOME}/Vídeos` }]);
  });

  it('answers nothing when the profile is unknown', async () => {
    const adapter = createLinuxUserFolders({ env: { HOME: '' }, home: '', fs: fakeFs({ files: {}, folders: [] }) });

    await expect(adapter.list()).resolves.toEqual([]);
  });
});
