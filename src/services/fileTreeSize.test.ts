// @vitest-environment node
// The folder tree is arithmetic over what the catalogue already listed, so these
// cases need neither a DOM nor a server: `getTreeSize` is the half that talks to
// one, and it is not the half that names a row.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import { setPlatformInfo, type PlatformInfo } from './platform';
import { createTreeSizeOps, type TreeSizeDeps } from './fileTreeSize';

/**
 * The two machines this build ships for. Only the separator and the case rule
 * reach path arithmetic, but the answer `/api/platform` gives carries all of it.
 */
const WINDOWS: PlatformInfo = {
  platform: 'win32',
  caseSensitive: false,
  separator: '\\',
  capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
};

const LINUX: PlatformInfo = {
  platform: 'linux',
  caseSensitive: true,
  separator: '/',
  capabilities: { paths: true, volumes: true, cleanup: false, trash: true, openWith: false },
};

beforeEach(() => setPlatformInfo(WINDOWS));
afterEach(() => setPlatformInfo(WINDOWS));

function listed(path: string, fullName: string, isDirectory: boolean, size = 0): FileItem {
  return {
    id: `${path}/${fullName}`,
    driveId: 'real_vol',
    path,
    fullName,
    name: isDirectory ? fullName : fullName.replace(/\.[^.]+$/, ''),
    ext: isDirectory ? '' : 'txt',
    isDirectory,
    size,
    createdAt: '2024-01-01 00:00:00',
    modifiedAt: '2024-01-01 00:00:00',
    attributes: { readOnly: false, hidden: false, system: false, archive: false },
  };
}

/**
 * A mounted Linux drive: the levels below `/mnt/data` are POSIX paths, so a
 * folder is joined with `/` and nothing in it is ever re-spelled.
 */
function posixDeps(files: FileItem[]): TreeSizeDeps {
  return {
    getFiles: (_driveId, currentPath) => files.filter((file) => file.path === currentPath),
    childAbsolutePath: (parentPath, childName) => `${parentPath === '/' ? '' : parentPath}/${childName}`,
    isSystemDrive: () => true,
    normalizePath: (path) => path.replace(/\/+$/, '') || '/',
  };
}

describe('folder labels on a POSIX root', () => {
  beforeEach(() => setPlatformInfo(LINUX));

  it('names a row by its last level instead of its whole address', () => {
    const files = [
      listed('/mnt/data', 'docs', true),
      listed('/mnt/data/docs', 'ana', true),
      listed('/mnt/data/docs/ana', 'nota.txt', false, 5),
    ];

    const tree = createTreeSizeOps(posixDeps(files)).getFolderSizes('/mnt/data', 'real_vol');

    expect(tree?.name).toBe('data');
    expect(tree?.subFolders?.map((folder) => folder.name)).toEqual(['docs']);
    expect(tree?.subFolders?.[0].subFolders?.[0].name).toBe('ana');
  });

  it('keeps the path it was given as the label of a root', () => {
    // `/` has no last level to name it by, so it stands for itself as it does on
    // a drive letter.
    const tree = createTreeSizeOps(posixDeps([])).getFolderSizes('/', 'real_vol');

    expect(tree?.name).toBe('/');
  });

  it('still sums the levels it walks', () => {
    const files = [
      listed('/mnt/data', 'docs', true),
      listed('/mnt/data', 'root.txt', false, 4),
      listed('/mnt/data/docs', 'ana', true),
      listed('/mnt/data/docs', 'a.txt', false, 2),
      listed('/mnt/data/docs/ana', 'nota.txt', false, 6),
    ];

    const tree = createTreeSizeOps(posixDeps(files)).getFolderSizes('/mnt/data', 'real_vol');

    expect(tree?.sizeBytes).toBe(12);
    expect(tree?.fileCount).toBe(3);
    expect(tree?.subFolders?.[0]).toMatchObject({ name: 'docs', sizeBytes: 8, fileCount: 2 });
  });
});
