// @vitest-environment node
// The module writes bytes and gzips them; neither needs a DOM, and jsdom here
// has no CompressionStream, so TAR.GZ could not be exercised in it.
import { describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import { createArchiveOps, type ArchiveOpsDeps } from './fileArchiveOps';

function item(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1',
    driveId: 'C:',
    path: '\\',
    fullName: 'nota.txt',
    name: 'nota',
    ext: 'txt',
    isDirectory: false,
    size: 4,
    createdAt: '2024-01-01T00:00:00.000Z',
    modifiedAt: '2024-01-01T00:00:00.000Z',
    attributes: { readOnly: false, hidden: false, system: false, archive: false },
    ...overrides,
  };
}

/**
 * The module takes its whole world as arguments, so the test can describe a
 * virtual drive without a server, a mount or a real archive on disk.
 */
function harness(overrides: Partial<ArchiveOpsDeps> = {}) {
  const remembered: FileItem[] = [];
  const deps: ArchiveOpsDeps = {
    normalizePath: (path) => path.replace(/\\+$/, '') || '\\',
    getParentPath: (path) => path.split('\\').slice(0, -1).join('\\') || '\\',
    childAbsolutePath: (parent, name) => `${parent === '\\' ? '' : parent}\\${name}`,
    absoluteForDrive: (_driveId, path) => path,
    realAbsolutePath: (file) => `${!file.path || file.path === '\\' ? '' : file.path}\\${file.fullName}`,
    realEntryName: (file) => file.fullName ?? '',
    isSystemDrive: () => false,
    getFiles: () => [],
    readFileBytes: async () => new TextEncoder().encode('hola'),
    createDirectory: () => item(),
    callServerFs: async () => null,
    lastCallError: () => 'el servidor rechazó la carpeta',
    rememberFile: (entry) => remembered.push(entry),
    saveToStorage: () => {},
    loadSystemDriveDirectory: async () => true,
    ...overrides,
  };
  return { ops: createArchiveOps(deps), remembered };
}

describe('fileArchiveOps', () => {
  it('has nothing mounted until an archive is opened', () => {
    const { ops } = harness();
    expect(ops.findArchive('C:', '\\copia.zip')).toBeUndefined();
    expect(ops.getArchiveSource('C:', '\\copia.zip')).toBeUndefined();
    expect(ops.findMountedItem('archive_C_\\copia.zip\\a.txt')).toBeUndefined();
  });

  it('writes a created TAR into the catalogue', async () => {
    const { ops, remembered } = harness();
    const created = await ops.createArchive([item()], 'copia', 'C:', '\\', 'TAR');
    expect(created.fullName).toBe('copia.tar');
    expect(created.contentEncoding).toBe('base64');
    expect(created.size).toBeGreaterThan(0);
    expect(remembered).toEqual([created]);
  });

  it('names the file after the format that was actually written', async () => {
    const { ops } = harness();
    const created = await ops.createArchive([item()], 'copia.zip', 'C:', '\\', 'TAR.GZ');
    expect(created.fullName).toBe('copia.tar.gz');
  });

  it('refuses to overwrite a name the panel already lists', async () => {
    const { ops, remembered } = harness({ getFiles: () => [item({ fullName: 'copia.tar' })] });
    await expect(ops.createArchive([item()], 'copia', 'C:', '\\', 'TAR')).rejects.toThrow('copia.tar');
    expect(remembered).toHaveLength(0);
  });

  it('writes bytes into a virtual folder and keeps them as base64', async () => {
    const { ops, remembered } = harness();
    const written = await ops.writeBytes('C:', '\\', 'carpeta\\saludo.txt', new TextEncoder().encode('hola'));
    expect(written.path).toBe('\\carpeta');
    expect(written.fullName).toBe('saludo.txt');
    expect(written.name).toBe('saludo');
    expect(written.ext).toBe('txt');
    expect(written.size).toBe(4);
    expect(written.content).toBe('aG9sYQ==');
    expect(remembered).toEqual([written]);
  });
});
