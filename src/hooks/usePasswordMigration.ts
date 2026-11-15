import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UserSettings } from '../types';
import { createPasswordRecord } from '../services/appLock';

/**
 * One-time migration: replace any legacy plaintext password with a salted
 * PBKDF2 hash so it is never persisted in clear. The removed `admin123` default
 * is dropped outright: it was a public master key, so hashing it would silently
 * reintroduce the bypass it came from.
 */
export function usePasswordMigration(
  settings: UserSettings,
  setSettings: Dispatch<SetStateAction<UserSettings>>,
): void {
  const passwordMigratedRef = useRef(false);
  useEffect(() => {
    if (passwordMigratedRef.current) return;
    passwordMigratedRef.current = true;
    if (settings.appPasswordHash === 'admin123' && !settings.appPasswordSalt) {
      setSettings((s) => ({ ...s, appPasswordHash: '', appPasswordSalt: '' }));
      return;
    }
    if (settings.appPasswordHash && !settings.appPasswordSalt) {
      createPasswordRecord(settings.appPasswordHash)
        .then((record) => setSettings((s) => ({ ...s, appPasswordHash: record.hash, appPasswordSalt: record.salt })))
        .catch(() => {});
    }
  }, []);
}
