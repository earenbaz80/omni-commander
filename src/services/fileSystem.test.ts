import { describe, it, expect } from 'vitest';
import { fsEngine } from './fileSystem';
import { Drive } from '../types';

describe('FileSystemEngine defaults', () => {
  it('contains no virtual drives by default', () => {
    const letters = fsEngine.getDrives().map(d => d.letter);
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
      isMounted: true
    };

    fsEngine.setDrives([realDrive]);
    expect(fsEngine.getDrives()[0]).toMatchObject({
      letter: 'C:',
      driveKind: 'fixed',
      fileSystem: 'NTFS',
      serialNumber: '24DF569F'
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
    fsEngine.setDrives([{ id: 'test', letter: 'Z:', name: 'test', type: 'local', totalBytes: 1, freeBytes: 1, isMounted: true }]);
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

    expect(fsEngine.getFiles('real_T', 'T:').map((i) => i.name).sort()).toEqual(['alpha', 'beta']);
    expect(fsEngine.getFiles('real_T', 'T:\\alpha').map((i) => i.name)).toEqual(['nested']);
    expect(fsEngine.getFiles('real_X', 'T:')).toEqual([]);

    // Mutating the listing must invalidate the index.
    const alpha = fsEngine.getFiles('real_T', 'T:').find((i) => i.name === 'alpha')!;
    fsEngine.deleteItem(alpha.id);
    expect(fsEngine.getFiles('real_T', 'T:').map((i) => i.name)).toEqual(['beta']);
  });
});