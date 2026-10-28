// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildTar, gunzip, gzip, isGzip, parseTar } from './tarArchive';
import {
  UnsupportedArchiveError,
  formatFromExtension,
  isOpenable,
  isServerReadable,
  loadArchiveBackend,
  withFormatExtension,
} from './archiveBackend';

/**
 * A real `.tar.gz` produced by bsdtar (the `tar.exe` that ships with Windows)
 * from a tree with nested folders, an empty folder, a Unicode name and a
 * 120-character path, then gzipped at level 9.
 *
 * Committing foreign bytes is the whole point: a fixture built by the writer in
 * this repository would only prove that it agrees with itself, and reading
 * other people's archives is exactly what the open path has to get right.
 */
const REF_TARGZ =
  'H4sICAYU4WoCA3JlZi50YXIAy8/Ny9QtSSzSTcusKCktStVnoD4wAAJzU1MGAzMDQ3NTQzBtYGAIFocCBkNTI3MDI0MjAwOgOkMTE3MzBgVTBjqA0mKg7xUUGFxTUnMUHItS85IzkzITFZwSU6sYRgDIR4//1NyCkkr9AY5/UzNjk9H4pwfQ09fTd/DJz0v3yczLppEdoAg2MzGBxTc6DYx2M5S0AEwt5uZGDAo+9Iz/EQow8n/OAAG9kooShlEwHOMfnv9xlv+mqOW/sRmwBGBQMBgt/2kOcoBFP9doNhjN/7D8n5daXJKaQtUGIBntP3Mzg9H230DGf0pqaoH+gMW/mZm56Wj8D3j8FyWW6yVl5lGt/Y8j/g3R49/IwNBktP6nD1D1yp+y8x6zhm/R9D0P2bQDSmftf8KpF1wx99BzHsOw6gVHX/GbRNYtPvFWyDymcdnpD6JW8S0rz32WsE1qX3Pxm/RoDTo88//hhc+mL302Z82LVfMo7pkRbP+bGKPlfyNTE8PR/E8P4FpckHh4Y36OAjy6FS4suNh8sfFi44VdF3Zc2Mk72jsYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBjKAABhylQJACgAAA==';

const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const encode = (value: string) => new TextEncoder().encode(value);

const binary64 = Uint8Array.from({ length: 64 }, (_, index) => (index * 37) % 256);
const longName = `${'l'.repeat(120)}.txt`;
const ROOT = 'omni-tar-fixture';

describe('TAR reader', () => {
  it('reads an archive written by bsdtar, with Unicode names and long paths', async () => {
    const bytes = decode(REF_TARGZ);
    expect(isGzip(bytes)).toBe(true);

    const backend = await loadArchiveBackend(bytes, 'ref.tar.gz');
    expect(backend.format).toBe('TAR.GZ');

    const byName = new Map(backend.entries.map((entry) => [entry.name, entry]));
    expect(byName.get(`${ROOT}/empty`)?.dir).toBe(true);
    expect(byName.get(`${ROOT}/nested/deep`)?.dir).toBe(true);
    expect(byName.get(`${ROOT}/nested/deep/raw.bin`)?.size).toBe(binary64.length);
    expect([...(await backend.readEntry(`${ROOT}/nested/deep/raw.bin`))]).toEqual([...binary64]);
    expect(new TextDecoder().decode(await backend.readEntry(`${ROOT}/nested/á日本語.txt`))).toBe(
      'Español 日本語 Русский\r\n',
    );
    // 120 characters do not fit a ustar name field, so bsdtar stores the path in
    // a POSIX extended header; dropping it would silently truncate the tree.
    expect(byName.get(`${ROOT}/${longName}`)?.size).toBe(5);
    expect(new TextDecoder().decode(await backend.readEntry(`${ROOT}/${longName}`))).toBe('long\n');
  });

  it('reads a plain .tar without the gzip layer', async () => {
    const backend = await loadArchiveBackend(await gunzip(decode(REF_TARGZ)), 'ref.tar');
    expect(backend.format).toBe('TAR');
    expect(backend.entries.map((entry) => entry.name)).toContain(`${ROOT}/nested/deep/raw.bin`);
  });
});

describe('TAR writer', () => {
  it('round-trips directories, empty folders, Unicode and a long path', async () => {
    const input = [
      { name: 'carpeta', dir: true },
      { name: 'carpeta/vacía', dir: true },
      { name: 'carpeta/á日本語.txt', dir: false, bytes: encode('Español 日本語 Русский\r\n') },
      { name: 'carpeta/deep/raw.bin', dir: false, bytes: binary64 },
      { name: longName, dir: false, bytes: encode('long\n') },
    ];
    const entries = parseTar(buildTar(input));

    expect(entries.map((entry) => entry.name)).toEqual([
      'carpeta',
      'carpeta/vacía',
      'carpeta/á日本語.txt',
      'carpeta/deep/raw.bin',
      longName,
    ]);
    expect(entries[1].dir).toBe(true);
    expect(new TextDecoder().decode(entries[2].read())).toBe('Español 日本語 Русский\r\n');
    expect([...entries[3].read()]).toEqual([...binary64]);
    expect(new TextDecoder().decode(entries[4].read())).toBe('long\n');
  });

  it('survives the gzip layer and reports its dates', async () => {
    const when = new Date('2026-02-03T04:05:06Z');
    const bytes = await gzip(buildTar([{ name: 'nota.txt', dir: false, bytes: encode('hola'), mtime: when }]));
    const backend = await loadArchiveBackend(bytes, 'nota.tar.gz');
    const entry = backend.entries[0];
    expect(new TextDecoder().decode(await entry.read())).toBe('hola');
    // TAR stores whole seconds, so only those may be compared.
    expect(Math.floor(entry.date.getTime() / 1000)).toBe(Math.floor(when.getTime() / 1000));
  });

  it('never exposes a symbolic link as a file', () => {
    // The writer cannot emit links, so one is forged by flipping the type flag
    // of a real entry and recomputing its header checksum.
    const tar = buildTar([{ name: 'enlace.txt', dir: false, bytes: encode('destino') }]);
    const forged = tar.slice();
    forged[156] = 0x32;
    forged.fill(0x20, 148, 156);
    let sum = 0;
    for (let index = 0; index < 512; index++) sum += forged[index];
    const checksum = sum.toString(8).padStart(6, '0');
    for (let index = 0; index < 6; index++) forged[148 + index] = checksum.charCodeAt(index);
    forged[154] = 0;
    forged[155] = 0x20;

    expect(parseTar(forged)).toEqual([]);
  });
});

describe('archive format rules', () => {
  it('refuses an archive whose path would escape the destination', async () => {
    await expect(
      loadArchiveBackend(buildTar([{ name: '../escape.txt', dir: false, bytes: encode('x') }]), 'x.tar'),
    ).rejects.toThrow();
  });

  // The renderer has no reader for these; the local server does (see
  // serverArchive). Refusing here with the format's name, instead of parsing the
  // bytes as TAR and reporting damage, is what lets the caller route it there.
  it('refuses a RAR and a 7-Zip naming the format instead of calling them corrupt', async () => {
    const rar = Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]);
    const sevenZip = Uint8Array.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]);

    for (const [bytes, name, label] of [
      [rar, 'pelicula.rar', 'RAR'],
      [sevenZip, 'copia.7z', '7-Zip'],
    ] as const) {
      const error = await loadArchiveBackend(bytes, name).catch((thrown) => thrown);
      expect(error).toBeInstanceOf(UnsupportedArchiveError);
      expect((error as Error).message).toContain(label);
    }
  });

  it('tells a gzipped file from a gzipped archive', async () => {
    const plain = await gzip(encode('solo texto, sin contenedor'));
    const error = await loadArchiveBackend(plain, 'notas.txt.gz').catch((thrown) => thrown);
    expect(error).toBeInstanceOf(UnsupportedArchiveError);
    expect((error as UnsupportedArchiveError).format).toBe('GZ');
    expect((error as Error).message).toContain('GZ');
  });

  it('keeps the extension of the chosen format and never compounds it', () => {
    expect(withFormatExtension('copia', 'ZIP')).toBe('copia.zip');
    // The old code appended `.ZIP` to whatever it was given, which is how a 7Z
    // selection produced a file named `copia.7z.ZIP`.
    expect(withFormatExtension('copia.7z', 'ZIP')).toBe('copia.zip');
    expect(withFormatExtension('copia.TAR', 'TAR.GZ')).toBe('copia.tar.gz');
    expect(withFormatExtension('copia.tar.gz', 'TAR')).toBe('copia.tar');
    expect(withFormatExtension('copia.rar', 'TAR')).toBe('copia.tar');
    expect(withFormatExtension('   ', 'TAR')).toBe('Archive_Package.tar');
  });

  it('calls a format openable when either engine has a reader for it', () => {
    expect(formatFromExtension('x.tar.gz')).toBe('TAR.GZ');
    expect(formatFromExtension('x.tgz')).toBe('TAR.GZ');
    expect(isOpenable(formatFromExtension('x.tar.gz'))).toBe(true);
    expect(isOpenable(formatFromExtension('x.tar'))).toBe(true);
    expect(isOpenable(formatFromExtension('x.zip'))).toBe(true);
    // Read by the local server through libarchive, not by this renderer, so the
    // UI may offer them while `loadArchiveBackend` still refuses them locally.
    for (const name of ['x.rar', 'x.7z', 'x.tar.bz2', 'x.tar.xz']) {
      expect(isServerReadable(formatFromExtension(name))).toBe(true);
      expect(isOpenable(formatFromExtension(name))).toBe(true);
    }
    expect(isServerReadable('ZIP')).toBe(false);
    expect(isOpenable('unknown')).toBe(false);
    expect(isOpenable('GZ')).toBe(false);
  });
});
