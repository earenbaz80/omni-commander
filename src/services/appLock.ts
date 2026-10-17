/**
 * Application-lock password handling.
 *
 * Passwords are never stored in plaintext: we keep a random salt plus a
 * PBKDF2-SHA256 derived hash (WebCrypto). Verification re-derives the hash
 * from the entered password and compares it in constant time.
 *
 * Note: like any purely client-side check, this is a barrier against casual
 * access, not a cryptographic guarantee against a determined local attacker.
 */

import { tGlobal } from '../i18n/translations';

export interface PasswordRecord {
  salt: string;
  hash: string;
}

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToBase64(bytes);
}

export async function deriveHash(password: string, salt: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(tGlobal('appLockNoWebCrypto'));
  }
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ToBytes(salt) as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_BITS
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function createPasswordRecord(password: string, salt: string = generateSalt()): Promise<PasswordRecord> {
  return { salt, hash: await deriveHash(password, salt) };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  if (!record?.salt || !record?.hash) return false;
  const candidate = await deriveHash(password, record.salt);
  return timingSafeEqual(candidate, record.hash);
}

/**
 * Verifies a password against a stored hash. When no salt is present the value
 * is treated as legacy plaintext (older versions stored the raw password).
 */
export async function checkPassword(password: string, storedHash: string, salt?: string): Promise<boolean> {
  if (!storedHash) return false;
  if (salt) return verifyPassword(password, { salt, hash: storedHash });
  return timingSafeEqual(password, storedHash);
}
