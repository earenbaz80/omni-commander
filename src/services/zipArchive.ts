import JSZip from 'jszip';
import { tGlobal } from '../i18n/translations';

/** Windows rejects control characters (0x00-0x1F) anywhere in a file name. */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

export function archiveEntryPath(name: string): string {
  const normalized = name.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  if (
    !normalized ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        hasControlChar(part) ||
        /[:*?"<>|]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new Error(tGlobal('zipErrPath').replace('{name}', name));
  }
  return parts.join('\\');
}

export async function loadArchive(bytes: Uint8Array, name: string, password?: string): Promise<JSZip> {
  // JSZip cannot decrypt encrypted entries, so there is no password option to
  // pass. The parameter stays in the signature until a decrypting backend is
  // wired in; silently dropping it here is why encrypted archives report as
  // corrupt instead of prompting.
  void password;
  let zip: JSZip;
  try {
    // `checkCRC32` inflates every entry at load time, and it was measured at 92-95%
    // of the time it takes to open an archive (1.03 s of 1.08 s for a 14 MiB ZIP
    // holding 58 MiB of documents). The same checksum is verified per entry when
    // it is read, which is both faster to list and stricter where it matters:
    // the bytes are checked before they are written anywhere. A damaged archive
    // therefore opens and lists its entries, and the corruption is discovered
    // when the affected entry is extracted or opened. See `readZipEntry` in
    // archiveBackend.ts.
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: true });
  } catch {
    throw new Error(tGlobal('zipErrCorrupt').replace('{name}', name));
  }
  const paths = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    archiveEntryPath(entry.unsafeOriginalName || entry.name);
    const path = archiveEntryPath(entry.name).toLowerCase();
    if (paths.has(path)) throw new Error(tGlobal('zipErrPath').replace('{name}', entry.name));
    paths.add(path);
  }
  return zip;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * CRC-32 of the bytes, the checksum a ZIP stores for every entry (the reflected
 * IEEE 802.3 polynomial that ZIP calls CRC-32). Entries are checked with this
 * when they are read, which is the only moment the decompressed bytes exist.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function base64ToBytes(content: string): Uint8Array {
  return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
}
