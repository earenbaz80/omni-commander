import { beforeEach, describe, expect, it } from 'vitest';
import { appendPath, driveForPath, samePath, setPlatformInfo, type PlatformInfo } from './platform';

/**
 * The two machines this build ships for. Path arithmetic reads only the
 * separator and whether the filesystem folds case, so the capability flags are
 * whatever each host would answer.
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

beforeEach(() => {
  setPlatformInfo(WINDOWS);
});

/** `pathKey` is private, so its cases go through the readers that use it. */
describe('pathKey', () => {
  it('folds the separators of a path on Windows', () => {
    expect(samePath('C:/Temp\\', 'c:\\temp')).toBe(true);
  });

  it('keeps a backslash as a name character on POSIX', () => {
    setPlatformInfo(LINUX);
    expect(samePath('/mnt/data/', '/mnt/data')).toBe(true);
    expect(samePath('/mnt/data', '\\mnt\\data')).toBe(false);
    expect(samePath('/mnt/data', '/mnt/Data')).toBe(false);
  });

  it('keeps one separator when the path is nothing but separators', () => {
    expect(samePath('/', '\\')).toBe(true);
    expect(samePath('/', '')).toBe(false);
  });
});

describe('appendPath', () => {
  it('joins under an absolute root with that root own separator', () => {
    expect(appendPath('C:\\', 'Users')).toBe('C:\\Users');
    expect(appendPath('C:\\Users\\', 'ana')).toBe('C:\\Users\\ana');
    setPlatformInfo(LINUX);
    expect(appendPath('C:\\Users', 'ana')).toBe('C:\\Users\\ana');
    expect(appendPath('/mnt/data/', 'docs')).toBe('/mnt/data/docs');
  });

  it('takes the separator of the machine for a relative parent', () => {
    expect(appendPath('docs', 'ana')).toBe('docs\\ana');
    setPlatformInfo(LINUX);
    expect(appendPath('docs', 'ana')).toBe('docs/ana');
  });

  it('returns the child alone when there is no parent', () => {
    expect(appendPath('', 'ana')).toBe('ana');
  });
});

describe('driveForPath', () => {
  it('picks the most specific root, and only across a separator', () => {
    setPlatformInfo(LINUX);
    const drives = [
      { id: 'root', root: '/' },
      { id: 'data', root: '/mnt/data' },
    ];
    expect(driveForPath(drives, '/mnt/data/docs')?.id).toBe('data');
    expect(driveForPath(drives, '/home/ana')?.id).toBe('root');
    expect(driveForPath(drives, '/mnt/database')?.id).toBe('root');
  });

  it('matches a drive letter regardless of case', () => {
    const drives = [
      { id: 'real_C', root: 'C:\\' },
      { id: 'users', root: 'C:\\Users' },
    ];
    expect(driveForPath(drives, 'c:\\Windows')?.id).toBe('real_C');
    expect(driveForPath(drives, 'C:\\Users\\ana')?.id).toBe('users');
  });

  it('leaves a path no root covers unmatched', () => {
    expect(driveForPath([{ id: 'real_C', root: 'C:\\' }], 'E:\\backup')).toBeUndefined();
    expect(driveForPath([{ id: 'real_C', root: 'C:\\' }], '')).toBeUndefined();
  });
});
