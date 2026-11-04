import { useCallback, useEffect, useState } from 'react';
import { fetchSystemStats } from '../services/systemStats';

/**
 * Whether this process really runs elevated, and the one way to change that.
 *
 * The info drawer used to toggle a boolean that changed nothing about the
 * process: it printed rights the window did not have. The answer now comes from
 * the server's system stats, which is the only side that can see the token of
 * the process it was started from.
 *
 * It is read once on purpose. Rights cannot be gained in-process, only by
 * relaunching, and a relaunch replaces the process that asked — so there is
 * nothing to poll and no state to keep in sync.
 */
export interface Elevation {
  /** True when the operating system reports this process as elevated. */
  isElevated: boolean;
  /** Asks Windows for an elevated restart; a no-op outside Electron. */
  requestElevation: () => Promise<void>;
}

export function useElevation(): Elevation {
  const [isElevated, setIsElevated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSystemStats().then((stats) => {
      if (!cancelled && stats) setIsElevated(stats.elevated === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Ask Windows for an elevated restart; there is no way to gain rights in-process. */
  const requestElevation = useCallback(async () => {
    const bridge = window.electronAPI;
    if (typeof bridge?.relaunchAsAdmin !== 'function') return;
    try {
      await bridge.relaunchAsAdmin();
    } catch {
      // The main process records the outcome in its own log; this window is on
      // its way out either way.
    }
  }, []);

  return { isElevated, requestElevation };
}
