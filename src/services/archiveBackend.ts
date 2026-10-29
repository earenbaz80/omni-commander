/**
 * Single source of truth for "which archive formats can this app really use?".
 *
 * The compression window used to offer ZIP, TAR, TAR.GZ and 7Z while the engine
 * only ever produced ZIP bytes, and the open path pushed RAR, 7Z, TAR and GZ
 * through JSZip, so anything that was not a ZIP came back as "corrupt". Both
 * sides now ask this module: `CREATABLE_FORMATS` drives the format picker and
 * `loadArchiveBackend` dispatches to a backend that exists, or refuses with a
 * precise message naming the format it cannot read.
 *
 * `SERVER_READABLE_FORMATS` is the other half of that truth: RAR, 7-Zip and the
 * bzip2/lzma TARs are read by the local server through libarchive's WASM, so
 * they are openable even though this module cannot parse them. The split is
 * declared here, once, and every screen asks this module instead of keeping its
 * own list.
 */
import { tGlobal } from '../i18n/translations';
import { archiveEntryPath, crc32, loadArchive } from './zipArchive';
import { gunzip, isGzip, looksLikeTar, parseTar, type TarEntry } from './tarArchive';

/** Every format the app can recognise, whether or not it can read it. */
export type ArchiveFormatName = 'ZIP' | 'RAR' | '7Z' | 'TAR' | 'TAR.GZ' | 'TAR.BZIP2' | 'TAR.LZMA' | 'GZ' | 'unknown';

/** Formats the renderer reads and writes by itself. Nothing else may be created. */
export type OpenableArchiveFormat = 'ZIP' | 'TAR' | 'TAR.GZ';

/**
 * Formats only the local server can read, through libarchive's WASM.
 *
 * The renderer cannot host that engine: its browser build needs a Web Worker,
 * and the packaged app loads the renderer from file://, where Chromium refuses
 * to start one. The server already has the file on disk, so it lists and
 * extracts these formats there and the archive never crosses into the renderer.
 */
export type ServerArchiveFormat = 'RAR' | '7Z' | 'TAR.BZIP2' | 'TAR.LZMA';

export const CREATABLE_FORMATS: readonly OpenableArchiveFormat[] = ['ZIP', 'TAR', 'TAR.GZ'];
export const SERVER_READABLE_FORMATS: readonly ServerArchiveFormat[] = ['RAR', '7Z', 'TAR.BZIP2', 'TAR.LZMA'];
/** Every format the app can open, whichever engine ends up reading it. */
export const OPENABLE_FORMATS: readonly ArchiveFormatName[] = [...CREATABLE_FORMATS, ...SERVER_READABLE_FORMATS];

/** Extension each format must end with, longest first so `.tar.gz` wins. */
const EXTENSION_BY_FORMAT: Record<OpenableArchiveFormat, string> = {
  ZIP: '.zip',
  TAR: '.tar',
  'TAR.GZ': '.tar.gz',
};

/** Archive-ish extensions worth attempting to open, magic bytes deciding. */
export const ARCHIVE_EXTENSIONS = [
  'ZIP',
  'RAR',
  '7Z',
  '7ZIP',
  'TAR',
  'GZ',
  'TGZ',
  'TAZ',
  'TBZ2',
  'TZ',
  'BZ2',
  'R00',
  'R01',
  'R10',
  'R99',
];

const FORMAT_BY_EXTENSION: Record<string, ArchiveFormatName> = {
  ZIP: 'ZIP',
  RAR: 'RAR',
  R00: 'RAR',
  R01: 'RAR',
  R10: 'RAR',
  R99: 'RAR',
  '7Z': '7Z',
  '7ZIP': '7Z',
  TAR: 'TAR',
  TGZ: 'TAR.GZ',
  TBZ2: 'TAR.BZIP2',
  TZ: 'TAR.LZMA',
  TAZ: 'TAR.LZMA',
  GZ: 'TAR.GZ',
  BZ2: 'TAR.BZIP2',
};

/** Human name used in the "cannot open" message. */
const LABEL_BY_FORMAT: Record<ArchiveFormatName, string> = {
  ZIP: 'ZIP',
  RAR: 'RAR',
  '7Z': '7-Zip',
  TAR: 'TAR',
  'TAR.GZ': 'TAR.GZ',
  'TAR.BZIP2': 'TAR.BZ2',
  'TAR.LZMA': 'TAR.LZMA',
  GZ: 'GZ',
  unknown: '?',
};

/** True when some engine can read the format: this renderer or the server. */
export function isOpenable(format: ArchiveFormatName): boolean {
  return (OPENABLE_FORMATS as readonly string[]).includes(format);
}

/** True when only the local server can read it. */
export function isServerReadable(format: ArchiveFormatName): format is ServerArchiveFormat {
  return (SERVER_READABLE_FORMATS as readonly string[]).includes(format);
}

/** Friendly name of a recognised format, for messages and labels. */
export function formatLabel(format: ArchiveFormatName): string {
  return LABEL_BY_FORMAT[format];
}

/**
 * Format implied by the name alone. Used by the UI, which must decide what to
 * offer before any bytes are read; `detectArchiveFormat` has the final word
 * because an extension can lie.
 */
export function formatFromExtension(fileName: string): ArchiveFormatName {
  const name = fileName.toLowerCase();
  if (/\.tar\.gz$/.test(name) || /\.t(ar)?gz$/.test(name)) return 'TAR.GZ';
  if (/\.tar\.bz2$/.test(name) || /\.tbz2$/.test(name)) return 'TAR.BZIP2';
  if (/\.tar\.lzma$/.test(name) || /\.(tlz|taz)$/.test(name)) return 'TAR.LZMA';
  if (name.endsWith('.gz')) return 'TAR.GZ';
  if (name.endsWith('.bz2')) return 'TAR.BZIP2';
  if (name.endsWith('.xz')) return 'TAR.LZMA';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : '';
  return FORMAT_BY_EXTENSION[ext] ?? 'unknown';
}

/**
 * Real format of a file, from its magic bytes. A gzipped stream is decompressed
 * once so a `.tar.gz` (an archive of many files) is not confused with a plain
 * `.gz` (a single compressed file), which the app has no way to present as a
 * folder.
 */
export async function detectArchiveFormat(fileName: string, bytes: Uint8Array): Promise<ArchiveFormatName> {
  const fromName = formatFromExtension(fileName);
  if (bytes.length >= 4) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'ZIP';
    if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return 'RAR';
    if (bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf) return '7Z';
  }
  if (isGzip(bytes)) {
    try {
      return looksLikeTar(await gunzip(bytes)) ? 'TAR.GZ' : 'GZ';
    } catch {
      return fromName === 'TAR.GZ' ? 'TAR.GZ' : 'GZ';
    }
  }
  if (bytes.length > 3 && bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) return 'TAR.BZIP2';
  if (looksLikeTar(bytes)) return 'TAR';
  return fromName === 'unknown' ? 'unknown' : fromName;
}

/** Raised when the format is recognised but has no reader in this build. */
export class UnsupportedArchiveError extends Error {
  constructor(
    public filename: string,
    public format: ArchiveFormatName,
  ) {
    super(tGlobal('zipErrUnsupported').replace('{format}', LABEL_BY_FORMAT[format]));
    this.name = 'UnsupportedArchiveError';
  }
}

/**
 * Raised when a ZIP is password protected. JSZip cannot decrypt, so the caller
 * needs to say so instead of reporting a damaged file.
 */
export class ArchivePasswordError extends Error {
  constructor(
    public filename: string,
    public override message: string,
    public reason?: 'required' | 'invalid',
  ) {
    super(`Archive error: ${message}`);
    this.name = 'ArchivePasswordError';
  }
}

export interface ArchiveEntry {
  /** Path inside the archive, always slash separated. */
  name: string;
  dir: boolean;
  size: number;
  date: Date;
  read: () => Promise<Uint8Array>;
}

export interface ArchiveBackend {
  format: ArchiveFormatName;
  entries: ArchiveEntry[];
  /** Bytes of one entry, addressed by its stored name. */
  readEntry: (name: string) => Promise<Uint8Array>;
}

/**
 * Size the archive itself declares for an entry, in bytes.
 *
 * JSZip reads it from the central directory into a private `_data` field, which
 * its typings leave commented out; the only public way to learn the size was
 * `entry.async`, which inflates the entry -- so listing a ZIP used to decompress
 * every entry just to print a number that was already in the file. Entries that
 * did not come from a parsed archive have no `_data`, and those still have to be
 * read; nothing else in the app builds a ZipObject, so this stays a fallback.
 */
function declaredSize(entry: object): number | undefined {
  const data = (entry as { _data?: unknown })._data;
  // A zero-length entry keeps no CompressedObject: JSZip swaps its data for the
  // empty string and prepares it lazily, so the pending promise there is an
  // entry of 0 bytes rather than a size it forgot to record.
  if (data && typeof (data as PromiseLike<unknown>).then === 'function') return 0;
  const size = (data as { uncompressedSize?: unknown } | undefined)?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : undefined;
}

/**
 * The CRC-32 the archive declares for an entry. Synthetic entries (a zero-length
 * one, which JSZip prepares lazily) carry none, and are left unverified.
 */
function declaredCrc(entry: object): number | undefined {
  const data = (entry as { _data?: { crc32?: unknown } })._data;
  const crc = data?.crc32;
  return typeof crc === 'number' && Number.isFinite(crc) ? crc >>> 0 : undefined;
}

/**
 * Bytes of one ZIP entry, checked against the checksum the archive declares.
 *
 * Opening a ZIP no longer walks the whole file to verify it -- that pass was
 * measured at 92-95% of the opening time -- so the checksum is verified here,
 * entry by entry. This is the stricter place for it anyway: a damaged entry is
 * refused before its bytes reach the viewer, an extraction or the disk, and the
 * message names the archive, which is what the user can act on.
 */
async function readZipEntry(entry: { async: (type: 'uint8array') => Promise<Uint8Array> }, archiveName: string) {
  const bytes = await entry.async('uint8array');
  const declared = declaredCrc(entry);
  if (declared !== undefined && crc32(bytes) !== declared) {
    throw new Error(tGlobal('zipErrCorrupt').replace('{name}', archiveName));
  }
  return bytes;
}

/** Bit 0 of the general purpose flags of a ZIP local header means "encrypted". */
function isEncryptedZip(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03) return false;
  return (bytes[6] & 0x01) === 0x01;
}

async function loadZipBackend(bytes: Uint8Array, name: string, password?: string): Promise<ArchiveBackend> {
  if (isEncryptedZip(bytes)) {
    throw new ArchivePasswordError(name, tGlobal('zipErrEncrypted').replace('{name}', name), 'required');
  }
  const zip = await loadArchive(bytes, name, password);
  const entries: ArchiveEntry[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      entries.push({
        name: entry.name.replace(/\/+$/, ''),
        dir: true,
        size: 0,
        date: entry.date,
        read: async () => new Uint8Array(0),
      });
      continue;
    }
    entries.push({
      name: entry.name,
      dir: false,
      // The declared size, so listing a folder does not inflate its contents.
      // `read` is what decompresses, and only for the entry someone opens.
      size: declaredSize(entry) ?? (await entry.async('uint8array')).length,
      date: entry.date,
      read: () => readZipEntry(entry, name),
    });
  }
  return {
    format: 'ZIP',
    entries,
    readEntry: async (entryName: string) => {
      const entry = zip.file(entryName);
      if (!entry) throw new Error(tGlobal('zipErrEmpty'));
      return readZipEntry(entry, name);
    },
  };
}

function tarBackend(format: 'TAR' | 'TAR.GZ', entries: TarEntry[]): ArchiveBackend {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    format,
    entries: entries.map((entry) => ({ ...entry, read: async () => entry.read() })),
    readEntry: async (entryName: string) => {
      const entry = byName.get(entryName);
      if (!entry) throw new Error(tGlobal('zipErrEmpty'));
      return entry.read();
    },
  };
}

/**
 * Opens an archive the renderer can read by itself. Throws
 * `UnsupportedArchiveError` for a recognised format that lives in the other
 * engine (see `serverArchive`) or has no reader at all, and
 * `ArchivePasswordError` for an encrypted ZIP; parse failures become the same
 * "cannot read" message the ZIP path uses.
 */
export async function loadArchiveBackend(
  bytes: Uint8Array,
  fileName: string,
  password?: string,
): Promise<ArchiveBackend> {
  const format = await detectArchiveFormat(fileName, bytes);
  if (format === 'ZIP') return loadZipBackend(bytes, fileName, password);
  // Anything else is the server's business (RAR, 7-Zip, the bzip2/lzma TARs) or
  // has no reader at all (a bare .gz, an unknown file). Refusing here rather
  // than falling through keeps the "unsupported" message true.
  if (format !== 'TAR' && format !== 'TAR.GZ') throw new UnsupportedArchiveError(fileName, format);

  const tarBytes = format === 'TAR.GZ' ? await gunzip(bytes) : bytes;
  let entries: TarEntry[];
  try {
    entries = parseTar(tarBytes);
  } catch {
    throw new Error(tGlobal('zipErrCorrupt').replace('{name}', fileName));
  }
  // The ZIP loader vets every path before a mount exists; TAR gets the same
  // guarantee here, so a `../` entry is refused up front instead of surviving
  // until something tries to write it. An archive with nothing in it is not an
  // error: like an empty ZIP it simply mounts an empty folder.
  const seen = new Set<string>();
  for (const entry of entries) {
    archiveEntryPath(entry.name);
    const key = entry.name.toLowerCase();
    if (seen.has(key)) throw new Error(tGlobal('zipErrPath').replace('{name}', entry.name));
    seen.add(key);
  }
  return tarBackend(format, entries);
}

/** Extension, without the dot, that a format must be stored with. */
export function extensionForFormat(format: OpenableArchiveFormat): string {
  return EXTENSION_BY_FORMAT[format].replace(/^\./, '');
}

/** Name of the archive a caller wants, forced to match the chosen format. */
export function withFormatExtension(archiveName: string, format: OpenableArchiveFormat): string {
  const wanted = EXTENSION_BY_FORMAT[format];
  let base = archiveName.trim();
  // Strip only the trailing archive extension, the longest first, so
  // `backup.tar` + TAR.GZ becomes `backup.tar.gz` instead of `backup.tar.tar.gz`.
  for (const suffix of ['.tar.gz', '.tar.bz2', '.tar.lzma', '.zip', '.tar', '.7z', '.rar', '.tgz', '.gz']) {
    if (base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  if (!base) base = 'Archive_Package';
  return `${base}${wanted}`;
}
