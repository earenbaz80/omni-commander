import { describe, expect, it } from 'vitest';
import { archiveLevelOf, archiveLevels, archiveSeparator, joinArchivePath, parentArchivePath } from './archivePath';

/**
 * The two roots this build meets. Most of the module is pure string work, so the
 * cases below are written to hold under either platform rule; the case rule of a
 * mount is `findArchive`'s concern, not this one's.
 */
const POSIX_ROOT = '/mnt/vol/demo.zip';
const WINDOWS_ROOT = 'C:\\Carpetas\\demo.zip';

describe('archiveSeparator', () => {
  it('follows the root it is given', () => {
    expect(archiveSeparator(POSIX_ROOT)).toBe('/');
    expect(archiveSeparator(WINDOWS_ROOT)).toBe('\\');
  });
});

describe('archiveLevels', () => {
  it('splits a relative path written with either separator', () => {
    expect(archiveLevels('docs\\2026\\nota.txt')).toEqual(['docs', '2026', 'nota.txt']);
    expect(archiveLevels('/docs//2026/')).toEqual(['docs', '2026']);
    expect(archiveLevels('')).toEqual([]);
  });
});

describe('joinArchivePath', () => {
  it('joins with the separator of the root, on both platforms', () => {
    expect(joinArchivePath(POSIX_ROOT, 'docs\\2026')).toBe('/mnt/vol/demo.zip/docs/2026');
    expect(joinArchivePath(WINDOWS_ROOT, 'docs/2026')).toBe('C:\\Carpetas\\demo.zip\\docs\\2026');
  });

  it('does not double the separator a root ends with', () => {
    expect(joinArchivePath('/mnt/vol/', 'docs')).toBe('/mnt/vol/docs');
    expect(joinArchivePath('C:\\vol\\', 'docs')).toBe('C:\\vol\\docs');
  });

  it('leaves the root alone when there is no level to add', () => {
    expect(joinArchivePath(POSIX_ROOT, '')).toBe(POSIX_ROOT);
    expect(joinArchivePath(WINDOWS_ROOT)).toBe(WINDOWS_ROOT);
  });
});

describe('parentArchivePath', () => {
  it('gives the folder that holds a level, for both roots', () => {
    expect(parentArchivePath(POSIX_ROOT, 'docs\\2026\\nota.txt')).toBe('/mnt/vol/demo.zip/docs/2026');
    expect(parentArchivePath(WINDOWS_ROOT, 'docs/nota.txt')).toBe('C:\\Carpetas\\demo.zip\\docs');
  });

  it('gives the root itself for a top-level entry', () => {
    expect(parentArchivePath(POSIX_ROOT, 'nota.txt')).toBe(POSIX_ROOT);
  });
});

describe('archiveLevelOf', () => {
  it('returns the level, spelled like the root', () => {
    expect(archiveLevelOf(POSIX_ROOT, '/mnt/vol/demo.zip/docs/2026')).toBe('docs/2026');
    expect(archiveLevelOf(WINDOWS_ROOT, 'C:\\Carpetas\\demo.zip\\docs')).toBe('docs');
    // A root written with its trailing separator is still the same mount.
    expect(archiveLevelOf('/mnt/vol/', '/mnt/vol/docs')).toBe('docs');
  });

  it('returns an empty level for the mount itself', () => {
    expect(archiveLevelOf(POSIX_ROOT, '/mnt/vol/demo.zip')).toBe('');
    expect(archiveLevelOf(WINDOWS_ROOT, 'C:\\Carpetas\\demo.zip\\')).toBe('');
  });

  it('refuses a path outside the mount', () => {
    expect(archiveLevelOf(POSIX_ROOT, '/mnt/vol/demo.zip.old')).toBeNull();
    expect(archiveLevelOf(POSIX_ROOT, '/mnt/vol/otro.zip')).toBeNull();
    expect(archiveLevelOf(POSIX_ROOT, 'docs')).toBeNull();
    expect(archiveLevelOf(POSIX_ROOT, '/mnt/vol/demo.zip2/docs')).toBeNull();
  });

  it('has no level to give without a root', () => {
    expect(archiveLevelOf('', '/mnt/vol/demo.zip')).toBeNull();
  });
});
