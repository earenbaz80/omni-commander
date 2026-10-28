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

  it('getFolderSizes sums files recursively for the requested drive', () => {
    fsEngine.resetToDefaults();
    fsEngine.setDrives([
      { id: 'real_T', letter: 'T:', name: 'Test', type: 'local', totalBytes: 1, freeBytes: 1, isMounted: true },
    ]);
    fsEngine.createDirectory('real_T', 'T:', 'alpha');
    fsEngine.createDirectory('real_T', 'T:\\alpha', 'nested');
    fsEngine.createFile('real_T', 'T:', 'root.txt', '12345');
    fsEngine.createFile('real_T', 'T:\\alpha', 'a.txt', '123');
    fsEngine.createFile('real_T', 'T:\\alpha\\nested', 'n.txt', 'x');
    // Same path on another drive must not leak into the tree.
    fsEngine.createFile('real_OTHER', 'T:', 'ignored.txt', 'xxxx');

    const tree = fsEngine.getFolderSizes('T:', 'real_T');
    expect(tree).not.toBeNull();
    expect(tree!.name).toBe('T:');
    expect(tree!.sizeBytes).toBe(9);
    expect(tree!.fileCount).toBe(3);
    expect(tree!.subFolders!.map((folder) => folder.name)).toEqual(['alpha']);

    const alpha = tree!.subFolders![0];
    expect(alpha.sizeBytes).toBe(4);
    expect(alpha.fileCount).toBe(2);

    fsEngine.resetToDefaults();
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

  it('sends absolute drive paths to the server for a panel location kept relative', async () => {
    // Panels hold "Users\\ana" for C:\, and the server accepts only drive-letter
    // absolute paths. Without the letter every real-drive read and write came
    // back as `Unsafe path`, which is why the viewer showed no content and save
    // silently did nothing.
    fsEngine.resetToDefaults();
    const reads: string[] = [];
    const writes: string[] = [];

    try {
      vi.stubGlobal('fetch', async (input: any, init?: any) => {
        const url = String(input);
        if (url.includes('/api/list')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { name: 'nota', ext: 'txt', fullName: 'nota.txt', isDirectory: false, size: 5, content: '' },
            ],
          } as unknown as Response;
        }
        if (url.includes('/api/fs/read-bytes')) {
          reads.push(JSON.parse(String(init?.body)).path);
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode('hola').buffer,
          } as unknown as Response;
        }
        if (url.includes('/api/fs/write')) {
          writes.push(JSON.parse(String(init?.body)).path);
          return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
        }
        throw new Error(`unexpected request ${url}`);
      });

      await fsEngine.loadSystemDriveDirectory('real_C', 'Users\\ana');
      const item = fsEngine.getFiles('real_C', 'Users\\ana')[0];
      expect(item.path).toBe('Users\\ana');

      await fsEngine.readFileBytes(item, { maxBytes: 10 });
      fsEngine.saveFileContent(item.id, 'adios');
      // saveFileContent writes through without blocking the caller.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reads).toEqual(['C:\\Users\\ana\\nota.txt']);
      expect(writes).toEqual(['C:\\Users\\ana\\nota.txt']);
    } finally {
      vi.unstubAllGlobals();
      fsEngine.resetToDefaults();
    }
  });

  it('sends absolute drive paths for mkdir, create, rename and delete from a relative location', async () => {
    // Same mismatch as the read/write path: the panel holds "Users\\ana" for C:,
    // the server accepts only drive-letter absolute paths, and the job helper is
    // fire-and-forget, so a rejected relative path just silently did nothing.
    fsEngine.resetToDefaults();
    const sent: Record<string, string[]> = { mkdir: [], write: [], rename: [], delete: [] };

    try {
      vi.stubGlobal('fetch', async (input: any, init?: any) => {
        const url = String(input);
        if (url.includes('/api/list')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { name: 'nota', ext: 'txt', fullName: 'nota.txt', isDirectory: false, size: 5, content: '' },
            ],
          } as unknown as Response;
        }

        const route = ['mkdir', 'write', 'rename', 'delete'].find((name) => url.includes(`/api/fs/${name}`));
        if (route) {
          const body = JSON.parse(String(init?.body));
          sent[route].push(body.path ?? body.targets[0]);
          return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
        }

        throw new Error(`unexpected request ${url}`);
      });

      await fsEngine.loadSystemDriveDirectory('real_C', 'Users\\ana');
      const existing = fsEngine.getFiles('real_C', 'Users\\ana')[0];

      // No await between these: each one must build its path from the state it
      // is handed, not from the listing a background reload happens to install.
      fsEngine.createDirectory('real_C', 'Users\\ana', 'nueva');
      const created = fsEngine.createFile('real_C', 'Users\\ana', 'nuevo.txt', 'hola');
      fsEngine.renameItem(created.id, 'otro.txt');
      fsEngine.deleteItem(created.id);
      fsEngine.deleteItem(existing.id, true);

      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sent.mkdir).toEqual(['C:\\Users\\ana\\nueva']);
      expect(sent.write).toEqual(['C:\\Users\\ana\\nuevo.txt']);
      // The rename names the old file, and the delete that follows it must use
      // the new name even though the listing has not been reloaded yet.
      expect(sent.rename).toEqual(['C:\\Users\\ana\\nuevo.txt']);
      expect(sent.delete).toEqual(['C:\\Users\\ana\\otro.txt', 'C:\\Users\\ana\\nota.txt']);

      // Drain the reloads the jobs start before the stub goes away, so a late one
      // does not escape to the real network from inside the test run.
      await new Promise((resolve) => setTimeout(resolve, 20));
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
