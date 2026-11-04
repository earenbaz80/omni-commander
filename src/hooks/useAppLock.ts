import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The app lock: when the window is covered, and the two ways that changes.
 *
 * Engaging it without a stored password would either unlock with the removed
 * public default or trap the user behind a lock no credential can open, so both
 * the initial state and `lock()` refuse without a hash. That rule used to live in
 * three places in App; here it is one.
 *
 * Enabling the lock in Settings takes effect at once: the transition to enabled
 * re-locks the session, because a lock that needs a relaunch to appear is a lock
 * the user does not have yet.
 */
export interface AppLockSettings {
  /** Whether the user asked for the lock in Settings. */
  enabled: boolean;
  /** The stored password record, or an empty string when there is none. */
  passwordHash: string;
}

export interface AppLock {
  isAppLocked: boolean;
  /** Covers the window, but only while a password exists to open it again. */
  lock: () => void;
  /** Called by the lock screen once the typed password verified. */
  unlock: () => void;
}

export function useAppLock({ enabled, passwordHash }: AppLockSettings): AppLock {
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => enabled && !!passwordHash);

  const lock = useCallback(() => {
    setIsAppLocked(!!passwordHash);
  }, [passwordHash]);

  const unlock = useCallback(() => setIsAppLocked(false), []);

  // Only the transition to enabled locks: a session already locked by the user
  // must not be re-locked by an unrelated settings write.
  const lockWasEnabledRef = useRef(enabled);
  useEffect(() => {
    const wasEnabled = lockWasEnabledRef.current;
    lockWasEnabledRef.current = enabled;
    if (enabled && !wasEnabled) lock();
  }, [enabled, lock]);

  return { isAppLocked, lock, unlock };
}
