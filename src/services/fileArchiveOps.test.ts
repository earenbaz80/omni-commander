// @vitest-environment node
// The module writes bytes and gzips them; neither needs a DOM, and jsdom here
// has no CompressionStream, so TAR.GZ could not be exercised in it.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import {
  createArchiveOps,
  type ArchiveOpsDeps,
  type ExtractConflict,
  type ExtractConflictAnswer,
} from './fileArchiveOps';

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

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * An extraction into a virtual destination folder, with the answers a prompt
 * would give in order. The catalogue is the listed folder: what is written into
 * it joins the same array, so a second conflict sees the first one's result.
 */
async function extraction(
  existing: FileItem[],
  answers: ExtractConflictAnswer[],
  files: Record<string, string> = { 'nota.txt': 'hola', 'sub/dentro.txt': 'dentro' },
) {
  const bytes = await zipBytes(files);
  const catalogue = [...existing];
  const written: FileItem[] = [];
  const asked: ExtractConflict[] = [];
  const { ops } = harness({
    getFiles: (_driveId, path) => catalogue.filter((file) => file.path === path),
    readFileBytes: async () => bytes,
    rememberFile: (entry) => {
      written.push(entry);
      catalogue.push(entry);
    },
  });
  const source = item({ id: 'zip', driveId: 'C:', fullName: 'demo.zip', name: 'demo', ext: 'zip', size: bytes.length });
  const run = () =>
    ops.extractArchive(source, 'C:', '\\dest', undefined, {
      onConflict: async (conflict) => {
        asked.push(conflict);
        return answers.shift() ?? { action: 'skip', applyToAll: false };
      },
    });
  return { run, asked, written, catalogue };
}

describe('fileArchiveOps extraction conflicts', () => {
  const taken = (overrides: Partial<FileItem> = {}) =>
    item({ path: '\\dest', fullName: 'nota.txt', name: 'nota', size: 2, content: 'b2xk', ...overrides });

  it('asks once with both sides of the name that is taken', async () => {
    const { run, asked } = await extraction([taken()], [{ action: 'skip', applyToAll: false }]);

    await run();

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      entry: 'nota.txt',
      name: 'nota.txt',
      destination: '\\dest\\nota.txt',
      sourceSize: 4,
      destinationSize: 2,
    });
  });

  it('gives the prompt the destination date the server reports', async () => {
    const bytes = await zipBytes({ 'nota.txt': 'hola' });
    const modified = 1_700_000_000_000;
    const asked: ExtractConflict[] = [];
    const onDisk = { entries: [{ path: '\\dest\\nota.txt', name: 'nota.txt', isDirectory: false, size: 2, modified }] };
    const { ops } = harness({
      isSystemDrive: () => true,
      readFileBytes: async () => bytes,
      callServerFs: async () => onDisk,
    });
    const source = item({ driveId: 'C:', fullName: 'demo.zip', name: 'demo', ext: 'zip' });

    await ops.extractArchive(source, 'C:', '\\dest', undefined, {
      onConflict: async (conflict) => {
        asked.push(conflict);
        return { action: 'skip', applyToAll: false };
      },
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ destinationSize: 2, destinationModified: modified });
  });

  it('leaves the file and the rest of the archive alone when told to skip', async () => {
    const existing = taken();
    const { run, written } = await extraction([existing], [{ action: 'skip', applyToAll: false }]);

    await run();

    expect(written.map((file) => file.fullName)).toEqual(['dentro.txt']);
    expect(existing.content).toBe('b2xk');
  });

  it('replaces the listed entry in place instead of adding a second one', async () => {
    const existing = taken();
    const { run, written } = await extraction([existing], [{ action: 'overwrite', applyToAll: false }]);

    await run();

    expect(existing.content).toBe('aG9sYQ==');
    expect(existing.size).toBe(4);
    expect(written.map((file) => file.fullName)).toEqual(['dentro.txt']);
  });

  it('keeps both by writing the member under the next free name', async () => {
    const existing = taken();
    const { run, written } = await extraction([existing], [{ action: 'rename', applyToAll: false }]);

    await run();

    expect(written.map((file) => file.fullName)).toEqual(['nota (2).txt', 'dentro.txt']);
    expect(existing.fullName).toBe('nota.txt');
  });

  it('renames the old file aside and keeps the member at its own name', async () => {
    const existing = taken();
    const { run, written } = await extraction([existing], [{ action: 'rename-old', applyToAll: false }]);

    await run();

    expect(existing.fullName).toBe('nota (2).txt');
    expect(written.map((file) => file.fullName)).toEqual(['nota.txt', 'dentro.txt']);
  });

  it('overwrites only when the size says the file is different', async () => {
    const sameSize = taken({ size: 4 });
    const otherSize = taken({ size: 9 });

    await (await extraction([sameSize], [{ action: 'overwrite-if-different', applyToAll: false }])).run();
    await (await extraction([otherSize], [{ action: 'overwrite-if-different', applyToAll: false }])).run();

    expect(sameSize.content).toBe('b2xk');
    expect(otherSize.content).toBe('aG9sYQ==');
  });

  it('applies one answer to every later conflict when asked to', async () => {
    const existing = [taken({ fullName: 'a.txt', name: 'a' }), taken({ fullName: 'b.txt', name: 'b' })];
    const { run, asked, written } = await extraction(existing, [{ action: 'skip', applyToAll: true }], {
      'a.txt': 'aaaa',
      'b.txt': 'bbbb',
    });

    await run();

    expect(asked).toHaveLength(1);
    expect(written).toHaveLength(0);
  });

  it('keeps refusing the name when nobody can answer', async () => {
    const bytes = await zipBytes({ 'nota.txt': 'hola' });
    const { ops } = harness({
      getFiles: (_driveId, path) => (path === '\\dest' ? [taken()] : []),
      readFileBytes: async () => bytes,
    });
    const source = item({ driveId: 'C:', fullName: 'demo.zip', name: 'demo', ext: 'zip' });

    await expect(ops.extractArchive(source, 'C:', '\\dest')).rejects.toThrow('nota.txt');
  });
});
