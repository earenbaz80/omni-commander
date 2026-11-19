import { describe, it, expect } from 'vitest';
import { cleanupTargetsFor } from './cleanupTargets';
import type { PlatformCapabilities } from '../services/platform';

const withCleanup: PlatformCapabilities = {
  paths: true,
  volumes: true,
  cleanup: true,
  trash: true,
  openWith: true,
};

const withoutCleanup: PlatformCapabilities = { ...withCleanup, cleanup: false };

const ids = (capabilities: PlatformCapabilities, platform: 'win32' | 'linux') =>
  cleanupTargetsFor(capabilities, platform).map((entry) => entry.id);

describe('cleanupTargetsFor', () => {
  it('offers nothing where the adapter implements no cleanup', () => {
    expect(ids(withoutCleanup, 'linux')).toEqual([]);
    expect(ids(withoutCleanup, 'win32')).toEqual([]);
  });

  it('offers the three folders on Windows', () => {
    expect(ids(withCleanup, 'win32')).toEqual(['user-temp', 'windows-temp', 'prefetch']);
  });

  it('leaves the Windows-only folders out elsewhere', () => {
    expect(ids(withCleanup, 'linux')).toEqual(['user-temp']);
  });

  it('keeps the elevation requirement of each folder', () => {
    const windows = cleanupTargetsFor(withCleanup, 'win32');

    expect(windows.find((entry) => entry.id === 'user-temp')?.requiresAdmin).toBe(false);
    expect(windows.find((entry) => entry.id === 'prefetch')?.requiresAdmin).toBe(true);
  });
});
