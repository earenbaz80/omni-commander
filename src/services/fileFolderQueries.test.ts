// @vitest-environment node
// These questions are answered by the server; what this file pins is which two
// spellings count as the same folder, which is the platform's rule and not this
// module's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import { setPlatformInfo, type PlatformInfo } from './platform';
import { createFolderQueries } from './fileFolderQueries';

/**
 * The two machines this build ships for. Only the separator and the case rule
 * reach path identity, but the answer `/api/platform` gives carries all of it.
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

/** Only the `exists` answer matters here; no other route is ever asked. */
function missingWith(
  answer: { existing?: string[]; unchecked?: string[] } | null,
  paths: string[],
): Promise<string[] | null> {
  const queries = createFolderQueries({
    absoluteForDrive: (_driveId, targetPath) => targetPath,
    realAbsolutePath: (file: FileItem) => file.path,
    callServerFs: async <T>() => answer as T | null,
    lastCallError: () => '',
  });
  return queries.missingFolders(paths);
}

describe('missing folders on a case-sensitive root', () => {
  beforeEach(() => setPlatformInfo(LINUX));

  it('does not accept another case as the same folder', async () => {
    // `/mnt/Data` and `/mnt/data` are two folders on this host, so the pin has
    // to be reported as gone instead of surviving on its neighbour's existence.
    await expect(missingWith({ existing: ['/mnt/data'] }, ['/mnt/data', '/mnt/Data'])).resolves.toEqual(['/mnt/Data']);
  });

  it('still ignores a trailing separator and the spaces around it', async () => {
    await expect(missingWith({ existing: ['/mnt/data'] }, [' /mnt/data/ '])).resolves.toEqual([]);
  });

  it('keeps a folder the server could not check', async () => {
    await expect(missingWith({ existing: [], unchecked: ['/mnt/Data'] }, ['/mnt/Data'])).resolves.toEqual([]);
  });

  it('reports nothing when the server does not answer', async () => {
    await expect(missingWith(null, ['/mnt/data'])).resolves.toBeNull();
  });
});

describe('missing folders on a Windows drive', () => {
  it('keeps folding case, because the filesystem does', async () => {
    await expect(missingWith({ existing: ['C:\\Temp'] }, ['c:\\temp'])).resolves.toEqual([]);
  });
});
