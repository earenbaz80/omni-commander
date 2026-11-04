import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readCatalogue, writeCatalogue, type StoredCatalogue } from './filesystemStorage';
import type { Drive, FileItem } from '../types';

const drive = (id: string): Drive => ({
  id,
  letter: 'C:',
  name: 'Local',
  type: 'local',
  totalBytes: 100,
  freeBytes: 50,
  isMounted: true,
});

const file = (id: string): Omit<FileItem, 'content'> => ({
  id,
  name: 'nota.txt',
  ext: 'TXT',
  path: 'C:\\docs',
  driveId: 'real_C',
  isDirectory: false,
  size: 10,
  modifiedAt: '2026-01-01',
  createdAt: '2026-01-01',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
});

const empty: StoredCatalogue = { drives: [], files: [], recycleBin: [] };

describe('filesystemStorage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reads an empty catalogue when nothing was ever saved', () => {
    expect(readCatalogue()).toEqual(empty);
  });

  // Every build before the envelope wrote the bare arrays, so this is what an
  // upgrade finds on disk.
  it('reads the bare arrays an older build wrote', () => {
    localStorage.setItem('nc_drives_v1', JSON.stringify([drive('real_C')]));
    localStorage.setItem('nc_filesystem_v1', JSON.stringify([file('f1')]));
    localStorage.setItem('nc_recycle_bin_v1', JSON.stringify([]));

    const catalogue = readCatalogue();
    expect(catalogue.drives.map((entry) => entry.id)).toEqual(['real_C']);
    expect(catalogue.files.map((entry) => entry.id)).toEqual(['f1']);
    expect(catalogue.recycleBin).toEqual([]);
  });

  it('reads the versioned envelope this build writes', () => {
    writeCatalogue({ ...empty, drives: [drive('real_D')] });
    expect(JSON.parse(localStorage.getItem('nc_drives_v1') as string).version).toBe(1);
    expect(readCatalogue().drives.map((entry) => entry.id)).toEqual(['real_D']);
  });

  // The reason this module exists: one damaged entry used to make the engine
  // believe the whole catalogue was unreadable.
  it('keeps the good files when one entry is damaged', () => {
    localStorage.setItem('nc_filesystem_v1', JSON.stringify([file('f1'), { id: 42 }, file('f2')]));
    expect(readCatalogue().files.map((entry) => entry.id)).toEqual(['f1', 'f2']);
  });

  it('keeps a corrupt key from taking the other two with it', () => {
    localStorage.setItem('nc_drives_v1', JSON.stringify([drive('real_C')]));
    localStorage.setItem('nc_filesystem_v1', '{not json');

    const catalogue = readCatalogue();
    expect(catalogue.drives.map((entry) => entry.id)).toEqual(['real_C']);
    expect(catalogue.files).toEqual([]);
  });

  it('reports a failed write instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(writeCatalogue(empty)).toBe(false);
  });
});
