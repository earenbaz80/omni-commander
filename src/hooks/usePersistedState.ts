import { useEffect, useRef, useState } from 'react';
import { readStored, writeStored, type StoredSpec } from '../services/storage';

/**
 * `useState` for a value that outlives the window.
 *
 * The first read goes through `readStored`, so the value is validated and
 * migrated like any other key; every later change is written back inside the
 * versioned envelope. The write is skipped on mount on purpose: a key that did
 * not exist would otherwise appear holding the default before the user touched
 * anything, which makes "never configured" and "configured to the default" the
 * same thing to whatever reads that key next.
 */
export function usePersistedState<T>(key: string, spec: StoredSpec<T>): [T, React.Dispatch<React.SetStateAction<T>>] {
  const version = spec.version ?? 1;
  const [value, setValue] = useState<T>(() => readStored(key, spec));
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    writeStored(key, value, version);
  }, [key, value, version]);

  return [value, setValue];
}
