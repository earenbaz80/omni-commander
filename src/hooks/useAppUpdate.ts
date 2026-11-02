import { useCallback, useEffect, useState } from 'react';

export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

/**
 * Which feed the copy follows. `beta` opts into prereleases, which are published
 * apart from the stable ones; every other value is the stable feed, because a
 * test build must never arrive at someone who did not ask for it.
 */
export type AppUpdateChannel = 'stable' | 'beta';

/** What the interface knows about the updater, and nothing it does not need. */
export interface AppUpdateSnapshot {
  status: AppUpdateStatus;
  version: string | null;
  percent: number;
  error: string | null;
  /** Whether the updater exists here at all (not in development or portable). */
  enabled: boolean;
  /** The feed this copy follows. */
  channel: AppUpdateChannel;
}

export const IDLE_UPDATE: AppUpdateSnapshot = {
  status: 'idle',
  version: null,
  percent: 0,
  error: null,
  enabled: false,
  channel: 'stable',
};

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
  setUpdateChannel?: (channel: string) => Promise<unknown>;
  openExternal?: (url: string) => Promise<unknown>;
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
    enabled: source.enabled === true,
    channel: source.channel === 'beta' ? 'beta' : 'stable',
  };
}

export interface AppUpdate extends AppUpdateSnapshot {
  /** False outside Electron, where there is no main process to update. */
  supported: boolean;
  check: () => void;
  download: () => void;
  install: () => void;
  /** Follows the beta feed; every other value returns to stable. */
  setChannel: (channel: AppUpdateChannel) => Promise<boolean>;
  /**
   * Opens a link in the real browser, or null where the document can navigate
   * on its own (a plain browser build).
   */
  openExternal: ((url: string) => void) | null;
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

  // Switching channel is applied by the main process before it answers, so the
  // snapshot that comes back already says which feed is in force. A failure
  // leaves the previous channel on screen, which is what is still true.
  const setChannel = useCallback(
    async (channel: AppUpdateChannel) => {
      if (!api?.setUpdateChannel) return false;
      try {
        setSnapshot(normalizeUpdateSnapshot(await api.setUpdateChannel(channel)));
        return true;
      } catch {
        return false;
      }
    },
    [api],
  );

  // Electron blocks navigation out of the window, so a link that must leave the
  // app is handed to the shell. A browser needs none of this and gets no
  // handler, which leaves the anchor doing its normal job.
  const openExternal = useCallback(
    (url: string) => {
      const pending = api?.openExternal?.(url);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    },
    [api],
  );

  return {
    ...snapshot,
    supported,
    check,
    download,
    install,
    setChannel,
    openExternal: typeof api?.openExternal === 'function' ? openExternal : null,
  };
}
