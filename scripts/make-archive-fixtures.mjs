/**
 * Builds the archive fixtures the server suite reads.
 *
 * They are committed as bytes so the tests are hermetic, but a fixture that
 * nothing can regenerate is a mystery blob. This script is the provenance, and
 * it refuses to pretend: the RAR is assembled here from the format itself
 * (RAR 4.x blocks, a stored file, the CRC16 block header) because no free tool
 * can write one, while the ZIP, the 7-Zip and the compressed TARs come from
 * Windows' own `bsdtar`, which is an implementation independent of the reader
 * under test.
 *
 *   node scripts/make-archive-fixtures.mjs
 *
 * bsdtar is only used for the formats it can write; when it is missing the
 * committed fixtures are left untouched rather than replaced with something
 * less trustworthy.
 *
 * `sample-encrypted.rar` is the one fixture this script does not build: it is a
 * RAR with encrypted names and data (password `omnicmd`, entries `a.txt` and
 * `sub/b.txt`, same text as the others), written once by WinRAR `a -hpomnicmd
 * -m0`. No free tool writes RAR encryption, so it is committed as bytes and
 * left alone here; to rebuild it, run that command against the two files.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const OUTPUT = path.resolve('test-fixtures/archives');
const BSDTAR = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'bsdtar';

const TEXT = 'hola archivo\n';
const NESTED = 'anidado en la carpeta\n';

const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

/** DOS date/time, which is what a RAR 4.x file header still stores. */
function dosStamp(date) {
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return day | (time << 16);
}

/** A RAR 4.x block: CRC16 of everything from the type byte on, then the body. */
function rarBlock(type, flags, body) {
  const headSize = 7 + body.length;
  const head = Buffer.concat([Buffer.from([type]), u16(flags), u16(headSize), body]);
  return Buffer.concat([u16(zlib.crc32(head) & 0xffff), head]);
}

/** One stored (method 0x30) file: header, then the bytes unmodified. */
function rarStoredFile(name, data, stamp) {
  const nameBytes = Buffer.from(name, 'utf8');
  const body = Buffer.concat([
    u32(data.length), // packed size
    u32(data.length), // unpacked size
    Buffer.from([0x03]), // host OS: Unix, so the path uses '/'
    u32(zlib.crc32(data)), // file CRC
    u32(stamp),
    Buffer.from([0x14]), // minimum unpacker version
    Buffer.from([0x30]), // method: store
    u16(nameBytes.length),
    u32(0o100644),
    nameBytes,
  ]);
  return Buffer.concat([rarBlock(0x74, 0x8000, body), data]);
}

const stamp = dosStamp(new Date(2024, 0, 15, 10, 30, 0));

export function buildRarFixture() {
  return Buffer.concat([
    Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), // Rar!\x1a\x07\x00
    rarBlock(0x73, 0x0000, Buffer.concat([u16(0), u32(0)])), // archive header
    rarStoredFile('a.txt', Buffer.from(TEXT), stamp),
    rarStoredFile('sub/b.txt', Buffer.from(NESTED), stamp),
    rarBlock(0x7b, 0x4000, Buffer.alloc(0)), // end of archive
  ]);
}

function withBsdtar(extension, args, { wrapper = true } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-fixture-'));
  try {
    const tree = wrapper ? path.join(work, 'fixture') : work;
    fs.mkdirSync(path.join(tree, 'sub'), { recursive: true });
    // Names stay ASCII on purpose: bsdtar's 7-Zip writer segfaults (exit 139)
    // on a non-ASCII name on Windows, and a fixture that needs a crash to build
    // is not one worth keeping.
    fs.writeFileSync(path.join(tree, 'a.txt'), TEXT);
    fs.writeFileSync(path.join(tree, 'sub', 'b.txt'), NESTED);
    // The empty file is there to prove an empty entry still lands; the ZIP
    // fixture keeps the RAR's two entries instead, because that is the tree the
    // e2e spec extracts.
    if (wrapper) fs.writeFileSync(path.join(tree, 'vacio.txt'), '');
    const target = path.join(work, `fixture${extension}`);
    // Naming the entries, rather than archiving ".", keeps the archive being
    // written out of itself.
    const sources = wrapper ? ['fixture'] : ['a.txt', 'sub'];
    execFileSync(BSDTAR, ['-c', '-f', target, ...args, '-C', work, ...sources], { stdio: 'pipe' });
    return fs.readFileSync(target);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function buildSevenZipFixture() {
  return withBsdtar('.7z', ['--format', '7zip']);
}

/**
 * A plain ZIP with the payload at the root, like the RAR fixture, so the e2e
 * spec can walk it the same way. The 7-Zip keeps everything under `fixture/`
 * because that is what bsdtar's 7-Zip writer produced first; a ZIP has no such
 * quirk, and the root layout is the one the other fixtures already use.
 */
export function buildZipFixture() {
  return withBsdtar('.zip', ['--format', 'zip'], { wrapper: false });
}

export function buildTarBzip2Fixture() {
  return withBsdtar('.tar.bz2', ['-j']);
}

export function buildTarLzmaFixture() {
  return withBsdtar('.tar.xz', ['-J']);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const write = (name, bytes) => {
    fs.writeFileSync(path.join(OUTPUT, name), bytes);
    console.log(`${name}: ${bytes.length} bytes, crc32 ${zlib.crc32(bytes).toString(16)}`);
  };
  write('sample.rar', buildRarFixture());
  // sample-encrypted.rar is deliberately not rewritten: see the note at the top.
  for (const [name, build] of [
    ['sample.zip', buildZipFixture],
    ['sample.7z', buildSevenZipFixture],
    ['sample.tar.bz2', buildTarBzip2Fixture],
    ['sample.tar.xz', buildTarLzmaFixture],
  ]) {
    try {
      write(name, build());
    } catch (error) {
      console.warn(`${name}: skipped, ${BSDTAR} could not write it (${error.message})`);
    }
  }
}
