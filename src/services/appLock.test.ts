// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPasswordRecord, verifyPassword, checkPassword, deriveHash, generateSalt } from './appLock';

describe('appLock password hashing', () => {
  it('stores a salted hash instead of the plain password', async () => {
    const record = await createPasswordRecord('s3cret!');
    expect(record.salt).toBeTruthy();
    expect(record.hash).toBeTruthy();
    expect(record.hash).not.toBe('s3cret!');
    expect(record.hash).not.toContain('s3cret');
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const record = await createPasswordRecord('correct horse battery');
    expect(await verifyPassword('correct horse battery', record)).toBe(true);
    expect(await verifyPassword('wrong', record)).toBe(false);
  });

  it('produces different hashes for the same password with different salts', async () => {
    const saltA = generateSalt();
    const saltB = generateSalt();
    expect(saltA).not.toBe(saltB);
    const a = await createPasswordRecord('same', saltA);
    const b = await createPasswordRecord('same', saltB);
    expect(a.hash).not.toBe(b.hash);
  });

  it('is deterministic for the same password and salt', async () => {
    const salt = generateSalt();
    expect(await deriveHash('pw', salt)).toBe(await deriveHash('pw', salt));
  });

  it('rejects an empty or malformed record', async () => {
    expect(await verifyPassword('x', { salt: '', hash: '' })).toBe(false);
  });

  describe('checkPassword (backward compatible with legacy plaintext)', () => {
    it('verifies against a salted record', async () => {
      const record = await createPasswordRecord('hello');
      expect(await checkPassword('hello', record.hash, record.salt)).toBe(true);
      expect(await checkPassword('nope', record.hash, record.salt)).toBe(false);
    });

    it('still verifies a legacy plaintext password (no salt)', async () => {
      expect(await checkPassword('admin123', 'admin123', undefined)).toBe(true);
      expect(await checkPassword('nope', 'admin123', undefined)).toBe(false);
    });
  });
});
