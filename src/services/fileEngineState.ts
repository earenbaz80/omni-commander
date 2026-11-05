import type { Drive, FileItem, RecycleBinItem } from '../types';

/**
 * Everything the engine keeps in memory, in one holder.
 *
 * These used to be nine separate fields. They travel together because the
 * operations extracted from the engine reassign whole lists — dropping a folder's
 * descendants, emptying the trash, replacing the drive list — and because the
 * listing cache is invalidated by counters that the persistence layer bumps. A
 * copy of any of them would be a copy of state nothing reads any more.
 */
export interface EngineState {
  drives: Drive[];
  files: FileItem[];
  recycleBin: RecycleBinItem[];
  /** React subscribers; notified on every catalogue change. */
  listeners: Array<() => void>;
  /** Pending debounced write; null when everything is already on disk. */
  storageSaveTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped on every change, which is what invalidates the listing index. */
  filesVersion: number;
  filesIndexVersion: number;
  /** Files grouped by `driveId|normalizedPath` for O(1) lookups. */
  filesIndex: Map<string, FileItem[]>;
  /** Least-recently-used order of the directory buckets in `filesIndex`. */
  bucketOrder: Map<string, true>;
}
