import { useCallback, useEffect, useState } from 'react';

export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

/** What the interface knows about the updater, and nothing it does not need. */
export interface AppUpdateSnapshot {
  status: AppUpdateStatus;
  version: string | null;
  percent: number;
  error: string | null;
}

export const IDLE_UPDATE: AppUpdateSnapshot = { status: 'idle', version: null, percent: 0, error: null };

const STATUSES: ReadonlySet<string> = new Set<AppUpdateStatus>([
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'up-to-date',
  'error',
]);

interface UpdateBridge {
  getUpdateState?: () => Promise<unknown>;
  checkForUpdates?: () => Promise<unknown>;
  downloadUpdate?: () => Promise<unknown>;
  installUpdate?: () => Promise<unknown>;
  onUpdateState?: (callback: (snapshot: unknown) => void) => (() => void) | void;
}

function bridge(): UpdateBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: UpdateBridge }).electronAPI;
}

/**
 * Rebuilds a snapshot from whatever crossed the IPC boundary. The main process
 * is trusted, but the shape is not guaranteed across versions of the preload,
 * and a malformed value must not become a status the interface cannot render.
 */
export function normalizeUpdateSnapshot(value: unknown): AppUpdateSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const status =
    typeof source.status === 'string' && STATUSES.has(source.status) ? (source.status as AppUpdateStatus) : 'idle';
  const rawPercent = Number(source.percent);
  return {
    status,
    version: typeof source.version === 'string' && source.version.length > 0 ? source.version : null,
    percent: Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, Math.round(rawPercent))) : 0,
    error: typeof source.error === 'string' && source.error.length > 0 ? source.error : null,
  };
}

export interface AppUpdate extends AppUpdateSnapshot {
  /** False outside Electron, where there is no main process to update. */
  supported: boolean;
  check: () => void;
  download: () => void;
  install: () => void;
}

/**
 * Mirrors the updater state into React and exposes its three actions. The
 * component stays a plain view: every transition happens in the main process,
 * which pushes each change here, so two components using this hook always agree.
 */
export function useAppUpdate(): AppUpdate {
  const api = bridge();
  const supported = typeof api?.getUpdateState === 'function';
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot>(IDLE_UPDATE);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    const unsubscribe = api?.onUpdateState?.((incoming) => {
      if (!cancelled) setSnapshot(normalizeUpdateSnapshot(incoming));
    });

    // The first check starts before this component mounts, so the current state
    // is pulled once instead of waiting for the next transition.
    void api
      ?.getUpdateState?.()
      .then((current) => {
        if (!cancelled && current) setSnapshot(normalizeUpdateSnapshot(current));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [api, supported]);

  const check = useCallback(() => {
    void api
      ?.checkForUpdates?.()
      .then((next) => setSnapshot(normalizeUpdateSnapshot(next)))
      .catch(() => {});
  }, [api]);

  const download = useCallback(() => {
    void api
      ?.downloadUpdate?.()
      .then((next) => setSnapshot(normalizeUpdateSnapshot(next)))
      .catch(() => {});
  }, [api]);

  const install = useCallback(() => {
    void api?.installUpdate?.()?.catch(() => {});
  }, [api]);

  return { ...snapshot, supported, check, download, install };
}
