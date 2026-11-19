import { describe, it, expect } from 'vitest';
import { cleanupTargetsFor } from './cleanupTargets';
import type { PlatformInfo } from '../services/platform';

const info = (cleanup: boolean, platform: PlatformInfo['platform']): PlatformInfo => ({
  platform,
  caseSensitive: platform !== 'win32',
  separator: platform === 'win32' ? '\\' : '/',
  capabilities: { paths: true, volumes: true, cleanup, trash: true, openWith: platform === 'win32' },
});

const ids = (cleanup: boolean, platform: PlatformInfo['platform']) =>
  cleanupTargetsFor(info(cleanup, platform)).map((entry) => entry.id);

describe('cleanupTargetsFor', () => {
  it('offers nothing where the adapter implements no cleanup', () => {
    expect(ids(false, 'linux')).toEqual([]);
    expect(ids(false, 'win32')).toEqual([]);
  });

  it('offers the three folders on Windows', () => {
    expect(ids(true, 'win32')).toEqual(['user-temp', 'windows-temp', 'prefetch']);
  });

  it('leaves the Windows-only folders out elsewhere', () => {
    expect(ids(true, 'linux')).toEqual(['user-temp']);
  });

  it('keeps the elevation requirement of each folder', () => {
    const windows = cleanupTargetsFor(info(true, 'win32'));

    expect(windows.find((entry) => entry.id === 'user-temp')?.requiresAdmin).toBe(false);
    expect(windows.find((entry) => entry.id === 'prefetch')?.requiresAdmin).toBe(true);
  });
});
