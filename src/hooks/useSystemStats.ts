import { useEffect, useState } from 'react';
import { SystemStats } from '../types';
import { fetchSystemStats } from '../services/systemStats';

/**
 * Polls the live CPU and memory of the local server while `enabled` is true.
 *
 * Sampling costs a request on the embedded server, so the drawer only polls
 * while it is expanded. The last reading is kept when polling stops, so
 * reopening the drawer shows a number immediately instead of an empty row, and
 * a failed poll keeps the previous value rather than blanking it.
 */
export function useSystemStats(enabled: boolean, intervalMs = 3000) {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      const next = await fetchSystemStats();
      if (!cancelled && next) setStats(next);
    };

    void poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return stats;
}
