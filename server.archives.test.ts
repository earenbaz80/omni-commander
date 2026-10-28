// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { startServer } from '@/scripts/serverHarness';
import { fsEngine } from './src/services/fileSystem';
import { archiveEntryPath, bytesToBase64 } from './src/services/zipArchive';
import type { FileItem } from './src/types';

let child: ChildProcess;
let root: string;
let base: string;
let driveId: string;
const nativeFetch = globalThis.fetch;
/** Archives built by scripts/make-archive-fixtures.mjs, checked against bsdtar there. */
const fixturesDir = path.resolve('test-fixtures/archives');
const binary = Uint8Array.from({ length: 2_200_019 }, (_, i) => (i * 37) % 256);
const text = 'Español 日本語 Русский\r\n';
let archive: FileItem;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-archives-'));
  driveId = `real_${root[0].toUpperCase()}`;
  child = spawn(process.execPath, ['server.cjs'], {
    env: { ...process.env, PORT: '3997', OMNI_SESSION_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Archive test server did not start')), 15000);
    child.stdout!.on('data', (chunk) => {
      const match = String(chunk).match(/listening on http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.once('error', reject);
  });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    nativeFetch(url.startsWith('/') ? `${base}${url}` : url, init),
  );
  const zip = new JSZip();
  zip.file('nested/deep/raw.bin', binary);
  zip.file('nested/á日本語.txt', text);
  zip.file('no-nul.bin', Uint8Array.from([255, 254, 253, 128]));
  zip.folder('empty');
  await fs.writeFile(path.join(root, 'sample.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
  // Fixtures for the server-side engine (built by
  // scripts/make-archive-fixtures.mjs). They are placed here, before the first
  // listing, because the server caches a directory listing for two seconds and
  // a file copied afterwards would not appear until it expires.
  await fs.copyFile(path.join(fixturesDir, 'sample.rar'), path.join(root, 'sample.rar'));
  await fs.copyFile(path.join(fixturesDir, 'sample.rar'), path.join(root, 'disfrazado.zip'));
  await fs.copyFile(path.join(fixturesDir, 'sample.7z'), path.join(root, 'sample.7z'));
  await fs.copyFile(path.join(fixturesDir, 'sample.7z'), path.join(root, 'vacios.7z'));
  await fs.copyFile(path.join(fixturesDir, 'sample-encrypted.rar'), path.join(root, 'sample-encrypted.rar'));
  await fs.copyFile(path.join(fixturesDir, 'sample.tar.bz2'), path.join(root, 'sample.tar.bz2'));
  await fs.copyFile(path.join(fixturesDir, 'sample.tar.xz'), path.join(root, 'sample.tar.xz'));
  // Text wearing a .rar name: not a truncated archive, but a file that is not an
  // archive at all.
  await fs.writeFile(path.join(root, 'roto.rar'), Buffer.from('esto no es un archivo rar'));
  await fsEngine.loadSystemDriveDirectory(driveId, root);
  // By name, not by extension: `disfrazado.zip` is a RAR on purpose and would
  // otherwise be picked here and break every ZIP test below.
  archive = fsEngine.getFiles(driveId, root).find((f) => f.fullName === 'sample.zip')!;
  expect(archive.content).toBe('');
}, 20000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (child && child.exitCode === null) {
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
    });
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe('ZIP disk integration', () => {
  it('reads a real archive and preserves nested paths, Unicode and every binary byte', async () => {
    const destination = path.join(root, 'extracted');
    expect(await fsEngine.extractArchive(archive, driveId, destination)).toBe(3);
    expect((await fs.readFile(path.join(destination, 'nested/deep/raw.bin'))).equals(binary)).toBe(true);
    expect(await fs.readFile(path.join(destination, 'nested/á日本語.txt'), 'utf8')).toBe(text);
    expect([...(await fs.readFile(path.join(destination, 'no-nul.bin')))]).toEqual([255, 254, 253, 128]);
    expect((await fs.stat(path.join(destination, 'empty'))).isDirectory()).toBe(true);
  });

  it('opens virtual folders without writing and extracts a selected subtree', async () => {
    const virtualRoot = await fsEngine.openArchive(archive);
    const items = fsEngine.getFiles(archive.driveId, virtualRoot);
    expect(items.map((item) => item.fullName).sort()).toEqual(['empty', 'nested', 'no-nul.bin']);
    await fsEngine.loadSystemDriveDirectory(archive.driveId, virtualRoot);
    expect(fsEngine.getFiles(archive.driveId, virtualRoot)).toEqual(items);
    const inner = fsEngine.getFiles(archive.driveId, `${virtualRoot}\\nested`);
    expect(inner.map((item) => item.fullName).sort()).toEqual(['deep', 'á日本語.txt']);
    expect(fsEngine.getParentPath(virtualRoot)).toBe(root);
    const destination = path.join(root, 'selection');
    await fsEngine.copyItem(inner.find((f) => f.isDirectory)!.id, driveId, destination);
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
    const directory = fsEngine.getFiles(driveId, root).find((f) => f.name === 'extracted')!;
    await fsEngine.createArchive([directory], 'roundtrip.zip', driveId, root);
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(root, 'roundtrip.zip')));
    expect(await zip.file('extracted/nested/á日本語.txt')!.async('string')).toBe(text);
    expect((await zip.file('extracted/nested/deep/raw.bin')!.async('nodebuffer')).equals(binary)).toBe(true);
    expect(zip.files['extracted/empty/'].dir).toBe(true);
    expect((await fs.stat(source)).isDirectory()).toBe(true);
  });

  it('reports corrupt archives and refuses to overwrite existing files', async () => {
    await fs.writeFile(path.join(root, 'broken.zip'), Buffer.from('not a zip'));
    await expect(
      fsEngine.extractArchive({ ...archive, fullName: 'broken.zip' }, driveId, path.join(root, 'broken-output')),
    ).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'broken-output'))).rejects.toThrow();
    await expect(fsEngine.extractArchive(archive, driveId, path.join(root, 'extracted'))).rejects.toThrow();
    expect((await fs.readFile(path.join(root, 'extracted/nested/deep/raw.bin'))).equals(binary)).toBe(true);
  });

  it('rejects traversal before writing and refuses junction destinations', async () => {
    const zip = new JSZip();
    zip.file('../escaped.txt', 'escape');
    await fs.writeFile(path.join(root, 'unsafe.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(
      fsEngine.extractArchive({ ...archive, fullName: 'unsafe.zip' }, driveId, path.join(root, 'unsafe-output')),
    ).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'unsafe-output'))).rejects.toThrow();
    const outside = path.join(root, 'outside');
    const destination = path.join(root, 'junction-output');
    await fs.mkdir(outside);
    await fs.mkdir(destination);
    await fs.symlink(outside, path.join(destination, 'nested'), 'junction');
    await expect(fsEngine.extractArchive(archive, driveId, destination)).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it.each(['C:/escape', '/root.txt', '..\\escape', 'CON.txt', 'a:stream', 'a/../b', 'a. /b'])(
    'rejects unsafe Windows entry %s',
    (name) => {
      expect(() => archiveEntryPath(name)).toThrow();
    },
  );
});

describe('TAR support and format honesty', () => {
  const small = binary.subarray(0, 4096);

  it('writes a real .tar.gz that other tools can read, and reads it back', async () => {
    const tree = path.join(root, 'tartree');
    await fs.mkdir(path.join(tree, 'nested'), { recursive: true });
    await fs.mkdir(path.join(tree, 'vacía'));
    await fs.writeFile(path.join(tree, 'nested', 'á日本語.txt'), text);
    await fs.writeFile(path.join(tree, 'nested', 'raw.bin'), small);
    await fsEngine.loadSystemDriveDirectory(driveId, root);
    const directory = fsEngine.getFiles(driveId, root).find((f) => f.name === 'tartree')!;

    await fsEngine.createArchive([directory], 'tartree-backup', driveId, root, 'TAR.GZ');

    // Node's own zlib is a second opinion on the gzip layer, and the ustar magic
    // at offset 257 plus the 512-byte blocking is what the format actually
    // requires: neither is something this repository's writer can fake by
    // agreeing with its own reader.
    const written = await fs.readFile(path.join(root, 'tartree-backup.tar.gz'));
    const payload = zlib.gunzipSync(written);
    expect(payload.length % 512).toBe(0);
    expect(payload.subarray(257, 262).toString('latin1')).toBe('ustar');
    expect(payload.toString('utf8')).toContain('tartree/nested/á日本語.txt');

    const rarLike = { ...archive, fullName: 'tartree-backup.tar.gz' };
    expect(await fsEngine.openArchive(rarLike)).toContain('tartree-backup.tar.gz');

    const destination = path.join(root, 'tar-extracted');
    expect(await fsEngine.extractArchive(rarLike, driveId, destination)).toBe(2);
    expect((await fs.readFile(path.join(destination, 'tartree/nested/raw.bin'))).equals(small)).toBe(true);
    expect(await fs.readFile(path.join(destination, 'tartree/nested/á日本語.txt'), 'utf8')).toBe(text);
    expect((await fs.stat(path.join(destination, 'tartree/vacía'))).isDirectory()).toBe(true);
  });

  it('never builds a compound extension from the name it was given', async () => {
    await fs.writeFile(path.join(root, 'origen.7z'), Buffer.from([0x37, 0x7a, 0xbc, 0xaf]));
    await fsEngine.loadSystemDriveDirectory(driveId, root);
    const source = fsEngine.getFiles(driveId, root).find((f) => f.ext.toUpperCase() === '7Z')!;

    // Picking a format the engine cannot write used to leave a ZIP on disk named
    // `copia.7z.ZIP`; the stored name now always matches what was written.
    await fsEngine.createArchive([source], 'copia.7z', driveId, root, 'ZIP');
    const names = await fs.readdir(root);
    expect(names).toContain('copia.zip');
    expect(names.some((name) => name.toLowerCase() === 'copia.7z.zip')).toBe(false);
  });
});

describe('server-read archives (RAR, 7-Zip, compressed TARs)', () => {
  // Built by scripts/make-archive-fixtures.mjs. The RAR is assembled from the
  // format itself (no free tool writes one) and every fixture is checked against
  // Windows' own bsdtar there, so the bytes are not this repository's own output.
  const text = 'hola archivo\n';
  const nested = 'anidado en la carpeta\n';
  const cases: [string, string, number][] = [
    ['sample.rar', '', 2],
    ['sample.7z', 'fixture/', 3],
    ['sample.tar.bz2', 'fixture/', 3],
    ['sample.tar.xz', 'fixture/', 3],
  ];

  const findFile = (fileName: string) =>
    fsEngine.getFiles(driveId, root).find((entry) => (entry.fullName || '') === fileName)!;

  it.each(cases)('lists %s and extracts every byte it holds', async (fixture, prefix, files) => {
    const item = findFile(fixture);

    // The whole reason these go through the server: the archive's bytes never
    // enter the catalogue, however large it is.
    expect(item.content).toBe('');
    expect(item.contentEncoding).toBeUndefined();

    const virtualRoot = await fsEngine.openArchive(item);
    const folder = prefix.replace(/\/$/, '');
    const children = (at: string) => fsEngine.getFiles(driveId, at).map((entry) => entry.fullName);
    const top = folder ? `${virtualRoot}\\${folder}` : virtualRoot;
    expect(children(top)).toContain('a.txt');
    expect(children(top)).toContain('sub');
    expect(children(`${top}\\sub`)).toContain('b.txt');

    const destination = path.join(root, `extraido-${fixture.replace(/[^a-z0-9]/gi, '-')}`);
    expect(await fsEngine.extractArchive(item, driveId, destination)).toBe(files);
    expect(await fs.readFile(path.join(destination, `${prefix}a.txt`), 'utf8')).toBe(text);
    expect(await fs.readFile(path.join(destination, `${prefix}sub/b.txt`), 'utf8')).toBe(nested);
    expect((await fs.stat(path.join(destination, `${prefix}sub`))).isDirectory()).toBe(true);
  });

  it('keeps the empty file a 7-Zip carries', async () => {
    const item = findFile('vacios.7z');
    const virtualRoot = await fsEngine.openArchive(item);
    const inside = fsEngine.getFiles(driveId, `${virtualRoot}\\fixture`);
    const empty = inside.find((entry) => entry.fullName === 'vacio.txt')!;
    expect(empty.size).toBe(0);
    const destination = path.join(root, 'vacios-extraido');
    await fsEngine.extractArchive(item, driveId, destination);
    expect(await fs.readFile(path.join(destination, 'fixture/vacio.txt'))).toHaveLength(0);
  });

  it('follows the bytes, not the extension: a RAR named .zip still opens', async () => {
    const item = findFile('disfrazado.zip');

    const virtualRoot = await fsEngine.openArchive(item);
    expect(
      fsEngine
        .getFiles(driveId, virtualRoot)
        .map((entry) => entry.fullName)
        .sort(),
    ).toEqual(['a.txt', 'sub']);
    expect(fsEngine.getFiles(driveId, `${virtualRoot}\\sub`).map((entry) => entry.fullName)).toEqual(['b.txt']);
  });

  // libarchive reports an unrecognisable file as an archive with no entries
  // rather than as an error, so without a signature check this mounts as an
  // empty folder. A truncated archive that still starts like one is only listed
  // as empty; that limit is the engine's, and it is written down here on purpose.
  it('refuses a file that is not an archive instead of mounting an empty folder', async () => {
    const item = findFile('roto.rar');

    const error = (await fsEngine.openArchive(item).catch((thrown) => thrown)) as Error;
    expect(error.message).toContain('roto.rar');
    expect(error.message).not.toMatch(/zip/i);
  });

  // The reader has no streaming API, so the archive is held in memory several
  // times over. Past the ceiling the server refuses instead of asking for
  // gigabytes and taking the app down; the renderer turns that into its own
  // message rather than calling the file corrupt.
  it('refuses an archive over the memory ceiling, and allows one exactly at it', async () => {
    const fixture = await fs.readFile(path.join(fixturesDir, 'sample.rar'));
    const ceiling = fixture.length;
    const oversized = path.join(root, 'enorme.rar');
    // One byte over, and still refused before the signature is ever looked at.
    await fs.writeFile(oversized, Buffer.concat([fixture, Buffer.from([0])]));

    const limited = await startServer({
      env: { OMNI_SESSION_TOKEN: '', OMNI_ARCHIVE_MAX_BYTES: String(ceiling) },
    });
    try {
      const post = (route: string, body: unknown) =>
        nativeFetch(limited.url(route), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

      const refused = await post('/api/archives/inspect', { path: oversized });
      expect(refused.status).toBe(413);
      expect(await refused.json()).toMatchObject({
        code: 'too-large',
        sizeBytes: ceiling + 1,
        limitBytes: ceiling,
      });

      // Reading an entry out of it would be the costlier path, so it is refused too.
      const refusedEntry = await post('/api/archives/entry', { path: oversized, entry: 'a.txt' });
      expect(refusedEntry.status).toBe(413);
      expect(await refusedEntry.json()).toMatchObject({ code: 'too-large' });

      // The guard is a ceiling, not a ban: the same archive at exactly the
      // limit still opens.
      const allowed = await post('/api/archives/inspect', { path: path.join(root, 'sample.rar') });
      expect(allowed.status).toBe(200);
      expect(((await allowed.json()) as { entries: { name: string }[] }).entries.map((entry) => entry.name)).toContain(
        'a.txt',
      );
    } finally {
      await limited.stop();
    }
  });

  // The libarchive wasm this project vendors has no cryptographic support, so RAR
  // goes through unrar. Without that, an encrypted archive listed nothing and an
  // encrypted one with visible names handed back its own ciphertext.
  it('asks for an encrypted RAR password, rejects the wrong one and reads it with the right one', async () => {
    const archive = path.join(root, 'sample-encrypted.rar');
    const post = (route: string, body: unknown) =>
      nativeFetch(`${base}/api/archives/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const asked = await post('inspect', { path: archive });
    expect(asked.status).toBe(400);
    expect(await asked.json()).toMatchObject({ code: 'password-required', reason: 'required' });

    const refused = await post('inspect', { path: archive, password: 'mal' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'password-required', reason: 'invalid' });

    const opened = await post('inspect', { path: archive, password: 'omnicmd' });
    expect(opened.status).toBe(200);
    const { entries } = (await opened.json()) as { entries: { name: string }[] };
    // Sorted here because the server's order is a locale collation, and only the
    // set of names and the folders implied by them are what this test is about.
    expect(entries.map((entry) => entry.name).sort()).toEqual(['a.txt', 'sub', 'sub/b.txt']);

    const inner = await post('entry', { path: archive, entry: 'sub/b.txt', password: 'omnicmd' });
    expect(inner.status).toBe(200);
    expect(await inner.text()).toBe('anidado en la carpeta\n');
  });

  it('refuses one held in the virtual catalogue, naming the format and the drive', async () => {
    const bytes = await fs.readFile(path.join(fixturesDir, 'sample.rar'));
    const item: FileItem = {
      id: 'virtual-rar',
      driveId: 'cloud',
      path: 'C:',
      fullName: 'nube.rar',
      name: 'nube',
      ext: 'RAR',
      isDirectory: false,
      size: bytes.length,
      modifiedAt: '2026-01-01 00:00',
      createdAt: '2026-01-01 00:00',
      attributes: { readOnly: false, hidden: false, system: false, archive: true },
      content: bytesToBase64(new Uint8Array(bytes)),
      contentEncoding: 'base64',
    };

    const error = (await fsEngine.openArchive(item).catch((thrown) => thrown)) as Error;
    expect(error.message).toContain('RAR');
    expect(error.message).toMatch(/unidad física|disco/i);
  });
});
