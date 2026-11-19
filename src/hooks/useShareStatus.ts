import { useEffect, useState } from 'react';
import { fetchShareStatus, SharedFolder } from '../services/shareStatus';

/**
 * Follows the share the local server is running while `enabled` is true.
 *
 * Reading costs a request, so the drawer only asks while it is expanded. Once a
 * share has been reported it keeps answering even after polling stops, and a
 * failed poll keeps the previous answer instead of blanking the row: a status
 * that blinked out would read as "not shared" for a second.
 */
export function useShareStatus(enabled: boolean, intervalMs = 5000) {
  const [status, setStatus] = useState<SharedFolder | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      const next = await fetchShareStatus();
      if (!cancelled && next) setStatus(next);
    };

    void poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return status;
}
