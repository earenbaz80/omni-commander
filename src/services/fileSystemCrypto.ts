import { FileItem } from '../types';
import { fetchWithRetry } from '../utils/fetchWithRetry';

export interface FileHashes {
  md5: string;
  sha1: string;
  sha256: string;
}

/**
 * Cryptographic hash calculator.
 * Extracted from fileSystem.ts to keep the main engine file focused.
 *
 * Two sources of truth, never a fabricated one:
 * - A real-drive file has no bytes in the renderer (the server listing only
 *   returns metadata), so its hashes are computed server-side from the actual
 *   file bytes via GET /api/fs/hash.
 * - An in-memory/virtual file that genuinely carries `content` is hashed
 *   locally from that content.
 * If the bytes cannot be read, this rejects so the caller shows an error
 * instead of a plausible-looking digest that matches nothing.
 */

// Same loopback resolution as fileSystem.ts: relative /api/* paths never reach
// the embedded server from a file:// packaged renderer, so an Electron build
// must address it absolutely through the port the preload bridge exposes.
// Resolved per call (not at module load) so the bridge is read whenever the
// renderer actually asks for a hash.
function apiBase(): string {
  const bridge = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  if (!bridge?.isElectron) return '';
  const port = Number(bridge.apiPort);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 3001}`;
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** True when the item is a real-drive file whose bytes only the server can read. */
function isRealDriveFile(file: FileItem): boolean {
  return !file.isDirectory && file.driveId.startsWith('real_');
}

/** Hashes a real-drive file server-side, over its actual bytes. */
async function hashRealFile(file: FileItem): Promise<FileHashes> {
  const fullName = file.fullName || (file.ext ? `${file.name}.${file.ext}` : file.name);
  const target = `${file.path}${file.path.endsWith('\\') ? '' : '\\'}${fullName}`;
  const response = await fetchWithRetry(`${apiBase()}/api/fs/hash?path=${encodeURIComponent(target)}`);
  if (!response.ok) {
    // No fabricated digest: surface the server's reason so the modal can show it.
    let message = `Hash request failed (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body && body.error) message = String(body.error);
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  const data = await response.json();
  if (!data || !data.md5 || !data.sha1 || !data.sha256) {
    throw new Error('Hash response was incomplete');
  }
  return { md5: String(data.md5), sha1: String(data.sha1), sha256: String(data.sha256) };
}

/** Hashes in-memory content locally (virtual files that really carry bytes). */
async function hashContent(content: string): Promise<FileHashes> {
  const data = new TextEncoder().encode(content);
  // Real MD5 has no Web Crypto primitive, so it is computed here with a small
  // standards-correct implementation rather than a non-cryptographic stand-in.
  const md5 = md5Hex(data);
  const [sha1Buffer, sha256Buffer] = await Promise.all([
    crypto.subtle.digest('SHA-1', data),
    crypto.subtle.digest('SHA-256', data),
  ]);
  return { md5, sha1: toHex(sha1Buffer), sha256: toHex(sha256Buffer) };
}

/**
 * Minimal, self-contained MD5 over a byte array. Web Crypto does not expose MD5
 * and the app must stay dependency-free offline, so the standard algorithm is
 * implemented directly. Returns lowercase hex, 32 chars.
 */
function md5Hex(bytes: Uint8Array): string {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  const originalLength = bytes.length;
  const withPaddingLength = (((originalLength + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(withPaddingLength);
  buffer.set(bytes);
  buffer[originalLength] = 0x80;
  const bitLength = originalLength * 8;
  const view = new DataView(buffer.buffer);
  view.setUint32(withPaddingLength - 8, bitLength >>> 0, true);
  view.setUint32(withPaddingLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;

  for (let offset = 0; offset < withPaddingLength; offset += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(offset + i * 4, true);

    let A = a0,
      B = b0,
      C = c0,
      D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return Array.from(out)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function calculateFileHashes(file: FileItem): Promise<FileHashes> {
  // A virtual item that actually carries its bytes is hashed locally; a real
  // file never does, so it goes to the server.
  if (typeof file.content === 'string' && file.content.length > 0) {
    return hashContent(file.content);
  }
  if (isRealDriveFile(file)) {
    return hashRealFile(file);
  }
  // No bytes are available from any source. Refuse rather than invent a digest.
  throw new Error('No file bytes available to hash');
}
