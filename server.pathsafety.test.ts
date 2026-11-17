// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafePath, createPathPolicy, isDriveRoot } from './server/pathSafety.cjs';

/**
 * Every route asks this before it reads or writes anything, so a hostile path
 * has to stop here. The policy is explicit per platform: the same contract must
 * hold for drive letters and for POSIX mount points, and the default exports must
 * still follow the process running the suite.
 */

const windows = createPathPolicy('win32');
const posix = createPathPolicy('linux', { roots: ['/mnt/data', '/media/me/USB'] });
const winPath = (value: string) => path.win32.normalize(value);

describe('Windows path policy', () => {
  it('accepts drive-letter absolute paths', () => {
    expect(windows.isAbsoluteLocalPath(String.raw`C:\Windows`)).toBe(true);
    expect(windows.isAbsoluteLocalPath('d:/temp')).toBe(true);
    // The panels address a drive root as a bare letter with a colon.
    expect(windows.isAbsoluteLocalPath('C:')).toBe(true);
    expect(windows.isAbsoluteLocalPath(String.raw`  C:\x  `)).toBe(true);
  });

  it('rejects UNC, device and relative paths', () => {
    expect(windows.isAbsoluteLocalPath(String.raw`\\servidor\share\x`)).toBe(false);
    expect(windows.isAbsoluteLocalPath('//servidor/share/x')).toBe(false);
    expect(windows.isAbsoluteLocalPath(String.raw`\\?\C:\x`)).toBe(false);
    expect(windows.isAbsoluteLocalPath(String.raw`\\.\PhysicalDrive0`)).toBe(false);
    expect(windows.isAbsoluteLocalPath(String.raw`Windows\System32`)).toBe(false);
    expect(windows.isAbsoluteLocalPath('/etc')).toBe(false);
    expect(windows.isAbsoluteLocalPath('')).toBe(false);
    expect(windows.isAbsoluteLocalPath(undefined)).toBe(false);
    expect(windows.isAbsoluteLocalPath('https://example.com')).toBe(false);
  });

  it('completes the root and normalizes separators and relative segments', () => {
    expect(windows.assertSafePath('C:')).toBe('C:\\');
    expect(windows.assertSafePath(String.raw`  D:\x  `)).toBe(String.raw`D:\x`);
    expect(windows.assertSafePath('c:/temp/x')).toBe(String.raw`c:\temp\x`);
    expect(windows.assertSafePath(String.raw`C:\a\..\b`)).toBe(String.raw`C:\b`);
    expect(windows.assertSafePath(String.raw`C:\a\.\b`)).toBe(String.raw`C:\a\b`);
  });

  it('recognizes only a drive-letter root', () => {
    expect(windows.isDriveRoot('C:')).toBe(true);
    expect(windows.isDriveRoot(winPath('C:/'))).toBe(true);
    expect(windows.isDriveRoot('d:/')).toBe(true);
    expect(windows.isDriveRoot('  E:  ')).toBe(true);
    expect(windows.isDriveRoot(winPath('C:/Windows'))).toBe(false);
    expect(windows.isDriveRoot(winPath('C:/Windows/'))).toBe(false);
    expect(windows.isDriveRoot('/')).toBe(false);
  });

  it('protects a drive root from mutation', () => {
    expect(() => windows.assertMutablePath('C:')).toThrow(/drive root/);
    expect(() => windows.assertMutablePath(winPath('D:/'))).toThrow(/drive root/);
    expect(windows.assertMutablePath('C:/temp/x')).toBe(winPath('C:/temp/x'));
  });

  it('compares paths without case, like the filesystem', () => {
    expect(windows.samePath('C:/Temp', String.raw`c:\temp`)).toBe(true);
    expect(windows.samePath('C:/Temp', 'C:/Other')).toBe(false);
  });
});

describe('POSIX path policy', () => {
  it('accepts absolute POSIX paths and normalizes them', () => {
    expect(posix.isAbsoluteLocalPath('/')).toBe(true);
    expect(posix.isAbsoluteLocalPath('/home/me')).toBe(true);
    expect(posix.assertSafePath('/')).toBe('/');
    expect(posix.assertSafePath('/home/me/../me')).toBe('/home/me');
    expect(posix.assertSafePath('  /mnt/data  ')).toBe('/mnt/data');
  });

  it('rejects relative paths and Windows drive paths', () => {
    expect(posix.isAbsoluteLocalPath('home/me')).toBe(false);
    expect(posix.isAbsoluteLocalPath('C:\\Windows')).toBe(false);
    expect(() => posix.assertSafePath('home/me')).toThrow(/Unsafe path/);
    expect(() => posix.assertSafePath('C:\\Windows')).toThrow(/Unsafe path/);
  });

  it('recognizes / and every configured mount root', () => {
    expect(posix.isDriveRoot('/')).toBe(true);
    expect(posix.isDriveRoot('/mnt/data')).toBe(true);
    expect(posix.isDriveRoot('/mnt/data/')).toBe(true);
    expect(posix.isDriveRoot('/media/me/USB')).toBe(true);
    expect(posix.isDriveRoot('/mnt/data/../data')).toBe(true);
    expect(posix.isDriveRoot('/mnt/data/file')).toBe(false);
    expect(posix.isDriveRoot('/home/me')).toBe(false);
    expect(posix.isDriveRoot('/opt')).toBe(false);
  });

  it('always protects / even without configured roots', () => {
    const bare = createPathPolicy('linux', { roots: [] });

    expect(bare.isDriveRoot('/')).toBe(true);
    expect(bare.isDriveRoot('/mnt/data')).toBe(false);
  });

  it('loads mount roots through the injectable reader', () => {
    const policy = createPathPolicy('linux', { readRoots: () => ['/srv/data'] });

    expect(policy.isDriveRoot('/srv/data')).toBe(true);
    expect(policy.isDriveRoot('/srv')).toBe(false);
  });

  it('protects / and mount roots from mutation', () => {
    expect(() => posix.assertMutablePath('/')).toThrow(/drive root/);
    expect(() => posix.assertMutablePath('/mnt/data')).toThrow(/drive root/);
    expect(() => posix.assertMutablePath('/mnt/data/')).toThrow(/drive root/);
    expect(posix.assertMutablePath('/mnt/data/file')).toBe('/mnt/data/file');
  });

  it('compares paths with case, like the filesystem', () => {
    expect(posix.samePath('/home/me', '/home/me')).toBe(true);
    expect(posix.samePath('/home/Me', '/home/me')).toBe(false);
  });
});

describe('default process policy', () => {
  it('follows the platform running the suite', () => {
    if (process.platform === 'win32') {
      expect(assertSafePath('C:')).toBe('C:\\');
      expect(isDriveRoot('C:')).toBe(true);
      return;
    }
    expect(assertSafePath('/')).toBe('/');
    expect(isDriveRoot('/')).toBe(true);
  });
});
