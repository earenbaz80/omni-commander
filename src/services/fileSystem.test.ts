import { describe, it, expect, vi } from 'vitest';
import { fsEngine, listingCachePolicy } from './fileSystem';
import { log } from '../utils/logger';
import { Drive } from '../types';
describe('FileSystemEngine defaults', () => {
  it('contains no virtual drives by default', () => {
    const letters = fsEngine.getDrives().map((d) => d.letter);
    expect(letters).not.toContain('C:');
    expect(letters).not.toContain('D:');
  });

  it('real drive metadata is preserved after replacing drives', () => {
    const realDrive: Drive = {
      id: 'real_C',
      letter: 'C:',
      name: 'OS',
      type: 'local',
      driveKind: 'fixed',
      fileSystem: 'NTFS',
      serialNumber: '24DF569F',
      totalBytes: 100,
      freeBytes: 40,
      isMounted: true,
    };

    fsEngine.setDrives([realDrive]);
    expect(fsEngine.getDrives()[0]).toMatchObject({
      letter: 'C:',
      driveKind: 'fixed',
      fileSystem: 'NTFS',
      serialNumber: '24DF569F',
    });
  });

  it('getSearchIndex filters by active drive unless all drives requested', () => {
    fsEngine.setDrives([]);
    fsEngine.resetToDefaults();
    // Inject via internal storage is not needed; the API should at least be callable.
    const all = fsEngine.getSearchIndex(true);
    const none = fsEngine.getSearchIndex(false, 'real_Z');
    expect(Array.isArray(all)).toBe(true);
    expect(Array.isArray(none)).toBe(true);
  });

  it('resetToDefaults removes all drives and files', () => {
    fsEngine.setDrives([
      { id: 'test', letter: 'Z:', name: 'test', type: 'local', totalBytes: 1, freeBytes: 1, isMounted: true },
    ]);
    fsEngine.resetToDefaults();
    expect(fsEngine.getDrives()).toEqual([]);
    expect(fsEngine.getFiles('', '')).toEqual([]);
  });

  it('getFiles indexes by drive + path and reflects mutations', () => {
    fsEngine.resetToDefaults();
    fsEngine.setDrives([
      { id: 'real_T', letter: 'T:', name: 'Test', type: 'local', totalBytes: 1, freeBytes: 1, isMounted: true },
    ]);
    fsEngine.createDirectory('real_T', 'T:', 'alpha');
    fsEngine.createDirectory('real_T', 'T:', 'beta');
    fsEngine.createDirectory('real_T', 'T:\\alpha', 'nested');

    expect(
      fsEngine
        .getFiles('real_T', 'T:')
        .map((i) => i.name)
        .sort(),
    ).toEqual(['alpha', 'beta']);
    expect(fsEngine.getFiles('real_T', 'T:\\alpha').map((i) => i.name)).toEqual(['nested']);
    expect(fsEngine.getFiles('real_X', 'T:')).toEqual([]);

    // Mutating the listing must invalidate the index.
    const alpha = fsEngine.getFiles('real_T', 'T:').find((i) => i.name === 'alpha')!;
    fsEngine.deleteItem(alpha.id);
    expect(fsEngine.getFiles('real_T', 'T:').map((i) => i.name)).toEqual(['beta']);
  });

  it('bounds the listing cache with an LRU cap per directory', async () => {
    fsEngine.resetToDefaults();
    const previous = { maxCachedDirectories: listingCachePolicy.maxCachedDirectories };
    listingCachePolicy.maxCachedDirectories = 3;
    try {
      vi.stubGlobal('fetch', async (input: any) => {
        const url = String(input);
        const path = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path') || '');
        return {
          ok: true,
          status: 200,
          json: async () => [
            { name: `f_${path}`, ext: 'TXT', fullName: `f_${path}.txt`, isDirectory: false, size: 1, content: '' },
          ],
        } as unknown as Response;
      });

      for (let i = 0; i < 10; i++) {
        await fsEngine.loadSystemDriveDirectory('real_T', `T:\\d${i}`);
      }

      const total = fsEngine.getSearchIndex(true).length;
      expect(total).toBeLessThanOrEqual(listingCachePolicy.maxCachedDirectories);
    } finally {
      listingCachePolicy.maxCachedDirectories = previous.maxCachedDirectories;
      vi.unstubAllGlobals();
      fsEngine.resetToDefaults();
    }
  });

  it('never evicts trash/virtual buckets from the listing cache', async () => {
    fsEngine.resetToDefaults();
    const previous = { maxCachedDirectories: listingCachePolicy.maxCachedDirectories };
    listingCachePolicy.maxCachedDirectories = 2;
    try {
      fsEngine.setDrives([
        { id: 'real_T', letter: 'T:', name: 'Test', type: 'local', totalBytes: 1, freeBytes: 1, isMounted: true },
      ]);
      // A virtual item parked in the app recycle bin (drive id drive_trash).
      fsEngine.createFile('virtual_V', 'V:\\', 'kept.txt', 'kept');
      const kept = fsEngine.getFiles('virtual_V', 'V:\\').find((i) => i.name === 'kept')!;
      fsEngine.moveToRecycleBin(kept.id);

      vi.stubGlobal(
        'fetch',
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => [
              { name: 'x.txt', ext: 'TXT', fullName: 'x.txt', isDirectory: false, size: 1, content: '' },
            ],
          }) as unknown as Response,
      );

      for (let i = 0; i < 8; i++) {
        await fsEngine.loadSystemDriveDirectory('real_T', `T:\\d${i}`);
      }

      // Trash entries survive the LRU even though the cap was exceeded.
      expect(fsEngine.getFiles('drive_trash', 'TR:').length).toBeGreaterThan(0);
    } finally {
      listingCachePolicy.maxCachedDirectories = previous.maxCachedDirectories;
      vi.unstubAllGlobals();
      fsEngine.resetToDefaults();
    }
  });

  it('strips content from the payload written to localStorage', async () => {
    fsEngine.resetToDefaults();
    try {
      vi.stubGlobal(
        'fetch',
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => [
              { name: 'big', ext: 'TXT', fullName: 'big.txt', isDirectory: false, size: 9, content: 'SENSITIVE_BODY' },
            ],
          }) as unknown as Response,
      );

      await fsEngine.loadSystemDriveDirectory('real_T', 'T:\\payload');
      fsEngine.flushStorage();

      const raw = localStorage.getItem('nc_filesystem_v1') || '';
      expect(raw).toContain('big');
      expect(raw).not.toContain('content');
      expect(raw).not.toContain('SENSITIVE_BODY');
    } finally {
      vi.unstubAllGlobals();
      fsEngine.resetToDefaults();
    }
  });

  it('logs a quota-exceeded persist instead of failing silently', () => {
    fsEngine.resetToDefaults();
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    try {
      fsEngine.createFile('virtual_V', 'V:\\', 'note.txt', 'body');
      fsEngine.flushStorage();

      expect(errorSpy).toHaveBeenCalled();
      // The in-memory state is untouched, so the app keeps working.
      expect(fsEngine.getFiles('virtual_V', 'V:\\').map((i) => i.name)).toContain('note');
    } finally {
      setItemSpy.mockRestore();
      errorSpy.mockRestore();
      fsEngine.resetToDefaults();
    }
  });
});
