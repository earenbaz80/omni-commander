// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { fsEngine } from './src/services/fileSystem';
import { archiveEntryPath } from './src/services/zipArchive';
import type { FileItem } from './src/types';

let child: ChildProcess;
let root: string;
let base: string;
let driveId: string;
const nativeFetch = globalThis.fetch;
const binary = Uint8Array.from({ length: 2_200_019 }, (_, i) => (i * 37) % 256);
const text = 'Español 日本語 Русский\r\n';
let archive: FileItem;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-archives-'));
  driveId = `real_${root[0].toUpperCase()}`;
  child = spawn(process.execPath, ['server.cjs'], {
    env: { ...process.env, PORT: '3997', OMNI_SESSION_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Archive test server did not start')), 15000);
    child.stdout!.on('data', chunk => {
      const match = String(chunk).match(/listening on http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once('error', reject);
  });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.startsWith('/') ? `${base}${url}` : url, init));
  const zip = new JSZip();
  zip.file('nested/deep/raw.bin', binary);
  zip.file('nested/á日本語.txt', text);
  zip.file('no-nul.bin', Uint8Array.from([255, 254, 253, 128]));
  zip.folder('empty');
  await fs.writeFile(path.join(root, 'sample.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
  await fsEngine.loadSystemDriveDirectory(driveId, root);
  archive = fsEngine.getFiles(driveId, root).find(f => f.ext.toUpperCase() === 'ZIP')!;
  expect(archive.content).toBe('');
}, 20000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (child && child.exitCode === null) {
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe('ZIP disk integration', () => {
  it('reads a real archive and preserves nested paths, Unicode and every binary byte', async () => {
    const destination = path.join(root, 'extracted');
    expect(await fsEngine.extractZipArchive(archive, driveId, destination)).toBe(3);
    expect((await fs.readFile(path.join(destination, 'nested/deep/raw.bin'))).equals(binary)).toBe(true);
    expect(await fs.readFile(path.join(destination, 'nested/á日本語.txt'), 'utf8')).toBe(text);
    expect([...await fs.readFile(path.join(destination, 'no-nul.bin'))]).toEqual([255, 254, 253, 128]);
    expect((await fs.stat(path.join(destination, 'empty'))).isDirectory()).toBe(true);
  });

  it('opens virtual folders without writing and extracts a selected subtree', async () => {
    const virtualRoot = await fsEngine.openZipArchive(archive);
    const items = fsEngine.getFiles(archive.driveId, virtualRoot);
    expect(items.map(item => item.fullName).sort()).toEqual(['empty', 'nested', 'no-nul.bin']);
    await fsEngine.loadSystemDriveDirectory(archive.driveId, virtualRoot);
    expect(fsEngine.getFiles(archive.driveId, virtualRoot)).toEqual(items);
    const inner = fsEngine.getFiles(archive.driveId, `${virtualRoot}\\nested`);
    expect(inner.map(item => item.fullName).sort()).toEqual(['deep', 'á日本語.txt']);
    expect(fsEngine.getParentPath(virtualRoot)).toBe(root);
    const destination = path.join(root, 'selection');
    await fsEngine.copyItem(inner.find(f => f.isDirectory)!.id, driveId, destination);
    expect((await fs.readFile(path.join(destination, 'deep/raw.bin'))).equals(binary)).toBe(true);
    expect(await fs.readdir(destination)).toEqual(['deep']);
    await expect(fsEngine.moveItem(inner[0].id, driveId, destination)).rejects.toThrow();
    await expect(fsEngine.deleteItems(inner, false)).rejects.toThrow();
    expect(() => fsEngine.createFile(archive.driveId, virtualRoot, 'bad.txt')).toThrow();
  });

  it('imports files larger than the old 100 KB and JSON 2 MB limits without truncation', async () => {
    const destination = path.join(root, 'imported');
    await fsEngine.importBrowserFile(new File([binary], 'large.bin'), driveId, destination);
    expect((await fs.readFile(path.join(destination, 'large.bin'))).equals(binary)).toBe(true);
  });

  it('compresses real directories and empty folders with exact bytes', async () => {
    const source = path.join(root, 'extracted');
    await fsEngine.loadSystemDriveDirectory(driveId, root);
    const directory = fsEngine.getFiles(driveId, root).find(f => f.name === 'extracted')!;
    await fsEngine.createZipArchive([directory], 'roundtrip.zip', driveId, root);
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(root, 'roundtrip.zip')));
    expect(await zip.file('extracted/nested/á日本語.txt')!.async('string')).toBe(text);
    expect((await zip.file('extracted/nested/deep/raw.bin')!.async('nodebuffer')).equals(binary)).toBe(true);
    expect(zip.files['extracted/empty/'].dir).toBe(true);
    expect((await fs.stat(source)).isDirectory()).toBe(true);
  });

  it('reports corrupt archives and refuses to overwrite existing files', async () => {
    await fs.writeFile(path.join(root, 'broken.zip'), Buffer.from('not a zip'));
    await expect(fsEngine.extractZipArchive({ ...archive, fullName: 'broken.zip' }, driveId, path.join(root, 'broken-output'))).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'broken-output'))).rejects.toThrow();
    await expect(fsEngine.extractZipArchive(archive, driveId, path.join(root, 'extracted'))).rejects.toThrow();
    expect((await fs.readFile(path.join(root, 'extracted/nested/deep/raw.bin'))).equals(binary)).toBe(true);
  });

  it('rejects traversal before writing and refuses junction destinations', async () => {
    const zip = new JSZip();
    zip.file('../escaped.txt', 'escape');
    await fs.writeFile(path.join(root, 'unsafe.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(fsEngine.extractZipArchive({ ...archive, fullName: 'unsafe.zip' }, driveId, path.join(root, 'unsafe-output'))).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'unsafe-output'))).rejects.toThrow();
    const outside = path.join(root, 'outside');
    const destination = path.join(root, 'junction-output');
    await fs.mkdir(outside);
    await fs.mkdir(destination);
    await fs.symlink(outside, path.join(destination, 'nested'), 'junction');
    await expect(fsEngine.extractZipArchive(archive, driveId, destination)).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it.each(['C:/escape', '/root.txt', '..\\escape', 'CON.txt', 'a:stream', 'a/../b', 'a. /b'])('rejects unsafe Windows entry %s', name => {
    expect(() => archiveEntryPath(name)).toThrow();
  });
});
