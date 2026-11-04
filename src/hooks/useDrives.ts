import { useEffect, useState } from 'react';
import type { Drive } from '../types';
import { fsEngine } from '../services/fileSystem';

/**
 * The real drives of this machine, kept live.
 *
 * App used to own the poll and the store subscription in two separate effects
 * that had to agree with each other. A drive list is one thing, so one hook
 * owns it: the poll brings in devices Windows mounted after startup, and the
 * subscription republishes what the catalogue already knows when a rename or a
 * delete changes it.
 *
 * A failed poll backs off instead of retrying at the same pace: the first
 * attempts land while the embedded server is still binding its port, and in web
 * mode there is no server at all.
 */
const DRIVE_POLL_MS = 5000;
const DRIVE_POLL_RETRY_MS = 15000;

export function useDrives(): Drive[] {
  const [drives, setDrives] = useState<Drive[]>(() => fsEngine.getDrives());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The poll is cancelled for real on unmount, not just ignored: otherwise a
    // retrying read outlives the window and logs a failure for it.
    const controller = new AbortController();
    const poll = async () => {
      const answered = await fsEngine.loadRealDrivesFromApi({ signal: controller.signal });
      if (cancelled) return;
      timer = setTimeout(poll, answered ? DRIVE_POLL_MS : DRIVE_POLL_RETRY_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Any catalogue change — refresh, rename, delete — republishes the list.
  useEffect(() => fsEngine.subscribe(() => setDrives(fsEngine.getDrives())), []);

  return drives;
}
