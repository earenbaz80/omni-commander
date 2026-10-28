import { useSyncExternalStore } from 'react';

/**
 * Actions the panel that shows the size tree offers to the function-key bar.
 *
 * The bar and the panel are siblings under App, so neither can pass the other a
 * prop: the panel publishes its controls here while it is mounted and the bar
 * reads them. Only one panel shows the tree at a time (the toolbar opens it on
 * the right), which is why a single slot is enough.
 */
export interface DiskTreeControls {
  /** A walk is running, so "Stop" has something to stop. */
  scanning: boolean;
  /** A finished tree exists, so expand/collapse all have something to act on. */
  hasTree: boolean;
  /** The tree is following the other panel instead of staying pinned. */
  following: boolean;
  stop: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  pin: () => void;
  toggleFollow: () => void;
  close: () => void;
}

let current: DiskTreeControls | null = null;
const listeners = new Set<() => void>();

export function setDiskTreeControls(next: DiskTreeControls | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getDiskTreeControls(): DiskTreeControls | null {
  return current;
}

export function subscribeDiskTreeControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The mounted tree panel's controls, or null when no panel shows the tree. */
export function useDiskTreeControls(): DiskTreeControls | null {
  return useSyncExternalStore(subscribeDiskTreeControls, getDiskTreeControls, getDiskTreeControls);
}
