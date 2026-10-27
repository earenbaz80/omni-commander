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
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: true });
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
