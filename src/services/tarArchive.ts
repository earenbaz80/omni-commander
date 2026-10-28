/**
 * Minimal ustar reader and writer, plus the gzip layer that turns a `.tar.gz`
 * into bytes and back.
 *
 * JSZip only understands ZIP, so before this module existed the compressor
 * offered TAR and TAR.GZ while every one of those archives came out as a ZIP
 * with a compound `.tar.zip` name, and opening one reported "corrupt". TAR is a
 * simple container (512-byte blocks, an ASCII header per entry), so it is worth
 * supporting for real instead of pretending.
 *
 * Deliberate limits, so callers never over-promise:
 * - Only regular files and directories are read. Symlinks, hard links and device
 *   nodes are skipped: extracting them would let a crafted archive point outside
 *   the destination, and the app never writes anything but files.
 * - Compression is deflate-free (TAR stores bytes as they are) and the `.gz`
 *   layer uses the platform gzip streams, so `.tar.bz2`/`.tar.lzma` stay out.
 */

const BLOCK = 512;
/** ustar stores the size as 11 octal digits; anything above this needs base-256. */
const MAX_OCTAL_SIZE = 8 ** 11 - 1;

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

/** One entry of an archive, in the shape the rest of the app already consumes. */
export interface TarEntry {
  name: string;
  dir: boolean;
  size: number;
  date: Date;
  read: () => Uint8Array;
}

/** What a caller hands to `buildTar`. `bytes` is ignored for directories. */
export interface TarEntryInput {
  name: string;
  dir: boolean;
  bytes?: Uint8Array;
  mtime?: Date;
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * True when the bytes look like a TAR container. Used to tell a `.tar.gz` (an
 * archive) from a plain `.gz` (a single compressed file), which the app cannot
 * present as a folder either way.
 */
export function looksLikeTar(bytes: Uint8Array): boolean {
  if (bytes.length < BLOCK) return false;
  const header = bytes.subarray(0, BLOCK);
  if (isZeroBlock(header)) return false;
  // Newer tars carry the magic; older v7 ones only have a valid checksum.
  return readString(header, 257, 5) === 'ustar' || checksumMatches(header);
}

async function throughStream(
  bytes: Uint8Array,
  transform: ReadableWritablePair<Uint8Array, BufferSource>,
): Promise<Uint8Array> {
  // Copied into a plain ArrayBuffer-backed view: a Blob part must not be a view
  // over a possibly shared buffer.
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return throughStream(bytes, new DecompressionStream('gzip'));
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return throughStream(bytes, new CompressionStream('gzip'));
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

function readString(source: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = Math.min(start + length, source.length);
  while (end < limit && source[end] !== 0) end++;
  return textDecoder.decode(source.subarray(start, end));
}

/** Octal field, or GNU base-256 for values that do not fit (large files). */
function readNumber(source: Uint8Array, start: number, length: number): number {
  if (source[start] & 0x80) {
    let value = source[start] & 0x7f;
    for (let index = start + 1; index < start + length; index++) value = value * 256 + source[index];
    return value;
  }
  const text = readString(source, start, length).trim();
  if (!text) return 0;
  const value = parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function checksumMatches(header: Uint8Array): boolean {
  // The stored checksum is octal and NUL/space padded; the sum is taken with
  // those same eight bytes read as spaces, which is how the format defines it.
  let expected = 0;
  let digits = 0;
  for (let index = 148; index < 156; index++) {
    const byte = header[index];
    if (byte === 0 || byte === 0x20) continue;
    if (byte < 0x30 || byte > 0x37) return false;
    expected = expected * 8 + (byte - 0x30);
    digits++;
  }
  if (digits === 0) return false;
  let sum = 0;
  for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : header[index];
  return sum === expected;
}

/**
 * Reads every regular file and directory of a TAR container.
 *
 * Throws on a damaged header instead of returning a partial listing, so the
 * caller's "corrupt archive" message stays true.
 */
export function parseTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingName: string | undefined;
  let pendingPax: Map<string, string> | undefined;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    // Two zero blocks end the archive; a single one is what most writers emit.
    if (isZeroBlock(header)) break;
    if (!checksumMatches(header)) {
      throw new Error(`tar: header checksum mismatch at offset ${offset}`);
    }

    const typeflag = String.fromCharCode(header[156] || 0x30);
    const size = readNumber(header, 124, 12);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (dataEnd > bytes.length) throw new Error(`tar: entry at offset ${offset} is truncated`);

    // GNU long names, and the POSIX extended headers bsdtar writes for Unicode.
    if (typeflag === 'L') {
      pendingName = readString(bytes, dataStart, size).replace(/\0$/, '');
      offset = next;
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      if (typeflag === 'x') pendingPax = parsePax(textDecoder.decode(bytes.subarray(dataStart, dataEnd)));
      offset = next;
      continue;
    }
    if (typeflag === 'K') {
      offset = next;
      continue;
    }

    const stored = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const name = pendingPax?.get('path') ?? pendingName ?? (prefix ? `${prefix}/${stored}` : stored);
    const mtime = Number(pendingPax?.get('mtime'));
    const seconds = Number.isFinite(mtime) ? mtime : readNumber(header, 136, 12);
    pendingName = undefined;
    pendingPax = undefined;
    offset = next;

    if (!name) continue;
    const isDir = typeflag === '5' || name.endsWith('/');
    // '0'/'\0' regular, '7' contiguous; everything else (links, devices) is skipped.
    const isFile = typeflag === '0' || typeflag === '\0' || typeflag === '7';
    if (!isDir && !isFile) continue;

    entries.push({
      name: isDir ? name.replace(/\/+$/, '') : name,
      dir: isDir,
      size: isDir ? 0 : size,
      date: new Date(seconds * 1000),
      read: () => bytes.subarray(dataStart, dataEnd),
    });
  }

  return entries;
}

/** `path=…`/`mtime=…` records of a POSIX extended header. */
function parsePax(payload: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of payload.split('\n')) {
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const equals = line.indexOf('=', space);
    if (equals <= 0) continue;
    values.set(line.slice(space + 1, equals), line.slice(equals + 1));
  }
  return values;
}

function writeString(target: Uint8Array, start: number, length: number, value: string): void {
  const bytes = textEncoder.encode(value).subarray(0, length);
  target.set(bytes, start);
}

function writeOctal(target: Uint8Array, start: number, length: number, value: number): void {
  const text = Math.min(value, MAX_OCTAL_SIZE)
    .toString(8)
    .padStart(length - 1, '0');
  writeString(target, start, length - 1, text);
  target[start + length - 1] = 0;
}

/** Splits a long path into ustar's `name` + `prefix` fields, when it fits. */
function splitPath(name: string): { name: string; prefix: string } {
  if (textEncoder.encode(name).length <= 100) return { name, prefix: '' };
  for (let index = name.lastIndexOf('/'); index > 0; index = name.lastIndexOf('/', index - 1)) {
    const head = name.slice(0, index);
    const tail = name.slice(index + 1);
    if (textEncoder.encode(tail).length <= 100 && textEncoder.encode(head).length <= 155) {
      return { name: tail, prefix: head };
    }
  }
  return { name, prefix: '' };
}

function header(typeflag: string, name: string, prefix: string, size: number, mtimeSeconds: number, mode: number) {
  const block = new Uint8Array(BLOCK);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, mode);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtimeSeconds);
  block.fill(0x20, 148, 156);
  block[156] = typeflag.charCodeAt(0);
  writeString(block, 257, 6, 'ustar');
  writeString(block, 263, 2, '00');
  writeString(block, 265, 32, '');
  writeString(block, 297, 32, '');
  writeOctal(block, 329, 8, 0);
  writeOctal(block, 337, 8, 0);
  writeString(block, 345, 155, prefix);

  let sum = 0;
  for (const byte of block) sum += byte;
  writeString(block, 148, 6, sum.toString(8).padStart(6, '0'));
  block[154] = 0;
  block[155] = 0x20;
  return block;
}

/**
 * Builds a TAR container. Directory entries are emitted as ustar directories so
 * empty folders survive the round trip, exactly like the ZIP path already does.
 */
export function buildTar(entries: TarEntryInput[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const push = (...parts: Uint8Array[]) => chunks.push(...parts);

  for (const entry of entries) {
    const raw = entry.dir ? `${entry.name.replace(/\/+$/, '')}/` : entry.name;
    const seconds = Math.floor((entry.mtime ?? new Date()).getTime() / 1000);
    const payload = entry.dir ? new Uint8Array(0) : (entry.bytes ?? new Uint8Array(0));
    const split = splitPath(raw);

    // Anything ustar cannot hold goes in a GNU long-name entry, which is what
    // bsdtar and GNU tar read anyway.
    if (split.name === raw && !split.prefix && textEncoder.encode(raw).length > 100) {
      const longName = textEncoder.encode(`${raw}\0`);
      push(header('L', '././@LongLink', '', longName.length, seconds, 0o644));
      push(longName, new Uint8Array(Math.ceil(longName.length / BLOCK) * BLOCK - longName.length));
      push(header(entry.dir ? '5' : '0', raw.slice(0, 100), '', payload.length, seconds, entry.dir ? 0o755 : 0o644));
    } else {
      push(header(entry.dir ? '5' : '0', split.name, split.prefix, payload.length, seconds, entry.dir ? 0o755 : 0o644));
    }

    if (payload.length > 0) {
      push(payload, new Uint8Array(Math.ceil(payload.length / BLOCK) * BLOCK - payload.length));
    }
  }

  push(new Uint8Array(BLOCK * 2));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
