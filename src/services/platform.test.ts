import { beforeEach, describe, expect, it } from 'vitest';
import { appendPath, driveForPath, samePath, setPlatformInfo, type PlatformInfo } from './platform';

/**
 * The two machines this build ships for. The capability flags are irrelevant
 * here: these cases are about path arithmetic, which reads only the separator
 * and whether the filesystem folds case.
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

/**
 * `pathKey` is private on purpose -- it is the spelling equality uses, not a
 * public way to address a file -- so every case here goes through the readers
 * that depend on it.
 */
describe('pathKey', () => {
  it('folds the two separator spellings on Windows', () => {
    expect(samePath('C:/Temp', 'C:\\Temp')).toBe(true);
    expect(samePath('C:\\Temp\\', 'c:\\temp')).toBe(true);
  });

  it('keeps a backslash as a name character on POSIX', () => {
    setPlatformInfo(LINUX);
    expect(samePath('/mnt/data', '/mnt/data/')).toBe(true);
    expect(samePath('/mnt/data', '\\mnt\\data')).toBe(false);
    expect(samePath('/mnt/data', '/mnt/Data')).toBe(false);
  });

  it('keeps one separator for a path made only of separators', () => {
    setPlatformInfo(LINUX);
    expect(samePath('/', '/')).toBe(true);
    expect(samePath('/', '')).toBe(false);
    setPlatformInfo(WINDOWS);
    expect(samePath('/', '\\')).toBe(true);
  });
});

describe('appendPath', () => {
  it('joins under a Windows drive root with a backslash', () => {
    expect(appendPath('C:\\', 'Users')).toBe('C:\\Users');
    expect(appendPath('C:\\Users', 'ana')).toBe('C:\\Users\\ana');
    expect(appendPath('C:\\Users\\', 'ana')).toBe('C:\\Users\\ana');
  });

  it('joins under a POSIX root with a slash', () => {
    setPlatformInfo(LINUX);
    expect(appendPath('/', 'home')).toBe('/home');
    expect(appendPath('/mnt/data', 'docs')).toBe('/mnt/data/docs');
    expect(appendPath('/mnt/data/', 'docs')).toBe('/mnt/data/docs');
  });

  it('takes the separator of the machine for a relative parent', () => {
    expect(appendPath('docs', 'ana')).toBe('docs\\ana');
    setPlatformInfo(LINUX);
    expect(appendPath('docs', 'ana')).toBe('docs/ana');
  });

  it('keeps the separator an absolute parent already spells', () => {
    setPlatformInfo(LINUX);
    expect(appendPath('C:\\Users', 'ana')).toBe('C:\\Users\\ana');
  });

  it('returns the child alone when there is no parent', () => {
    expect(appendPath('', 'ana')).toBe('ana');
    expect(appendPath(undefined, 'ana')).toBe('ana');
  });
});

describe('driveForPath', () => {
  it('picks the most specific root that contains the path', () => {
    setPlatformInfo(LINUX);
    const drives = [
      { id: 'root', root: '/' },
      { id: 'data', root: '/mnt/data' },
    ];
    expect(driveForPath(drives, '/mnt/data/docs')?.id).toBe('data');
    expect(driveForPath(drives, '/home/ana')?.id).toBe('root');
  });

  it('does not match a sibling whose name starts the same way', () => {
    setPlatformInfo(LINUX);
    const drives = [
      { id: 'root', root: '/' },
      { id: 'data', root: '/mnt/data' },
    ];
    expect(driveForPath(drives, '/mnt/database')?.id).toBe('root');
  });

  it('matches a drive letter regardless of case', () => {
    const drives = [
      { id: 'real_C', root: 'C:\\' },
      { id: 'real_D', root: 'D:\\' },
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
