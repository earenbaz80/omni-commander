import { useCallback, useEffect, useState } from 'react';
import { fetchSystemStats } from '../services/systemStats';
import type { ElevationResult } from '../types/electronBridge';

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
  /**
   * Asks Windows for an elevated restart. A refusal is an answer, not a throw:
   * the caller needs it to explain why this window is still here.
   */
  requestElevation: () => Promise<ElevationResult | undefined>;
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
  const requestElevation = useCallback(async (): Promise<ElevationResult | undefined> => {
    const bridge = window.electronAPI;
    if (typeof bridge?.relaunchAsAdmin !== 'function') return { ok: false, reason: 'unsupported' };
    try {
      return await bridge.relaunchAsAdmin();
    } catch (error) {
      return {
        ok: false,
        reason: 'spawn-failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);

  return { isElevated, requestElevation };
}
