import type { FileItem } from '../types';

/**
 * The cleanup folders the toolbar offers. Only the user's temp folder can be
 * emptied without an elevated token; the server refuses the other two and the
 * menu shows them disabled with the reason.
 */
/**
 * Folders the toolbar's cleanup menu offers. Only the user's temp folder can be
 * emptied without an elevated token; the server refuses the other two and the
 * menu shows them disabled with the reason.
 */
export type CleanupTargetId = 'user-temp' | 'windows-temp' | 'prefetch';

/**
 * Folders the "Enviar a" menu drops a shortcut into. The renderer names one of
 * these and the server resolves the folder, so a request never carries a path
 * the user did not pick.
 */
export type SendToDestination = 'desktop' | 'documents' | 'downloads';

export const cleanupTargets: Array<{ id: CleanupTargetId; requiresAdmin: boolean }> = [
  { id: 'user-temp', requiresAdmin: false },
  { id: 'windows-temp', requiresAdmin: true },
  { id: 'prefetch', requiresAdmin: true },
];

/** A cleanup folder as the server resolves it; the renderer never names a path. */
export interface CleanupTarget {
  id: CleanupTargetId;
  path: string;
  requiresAdmin: boolean;
  exists: boolean;
}

/** What a cleanup would remove. Measured without removing anything. */
export interface CleanupScan {
  target: CleanupTargetId;
  path: string;
  minAgeDays: number;
  files: number;
  dirs: number;
  bytes: number;
  /** Entries left alone: reparse points and anything unreadable. */
  skipped: number;
  /** True when the folder was too large to measure in full. */
  truncated: boolean;
  largest: Array<{ name: string; size: number; modifiedMs: number }>;
}

/** What a cleanup did. `failedCount` counts what another program held on to. */
export interface CleanupRun {
  target: CleanupTargetId;
  path: string;
  minAgeDays: number;
  freedBytes: number;
  deletedFiles: number;
  deletedDirs: number;
  failed: Array<{ path: string; message: string }>;
  failedCount: number;
  skipped: number;
  truncated: boolean;
}

/**
 * What asking the server about folders needs: the absolute path of a real entry,
 * the request itself, and the last failure it left behind.
 *
 * `callServerFs` returns null instead of throwing because some callers fire it as
 * `void`, so the diagnostic has to be carried out of band and read afterwards;
 * that is why `lastCallError` is a dependency and not a local variable.
 */
export interface FolderQueriesDeps {
  absoluteForDrive: (driveId: string, targetPath: string) => string;
  realAbsolutePath: (file: FileItem) => string;
  callServerFs: <T>(route: string, body: unknown) => Promise<T | null>;
  lastCallError: () => string;
}

/**
 * The questions about folders that only the server can answer: which pinned paths
 * still exist, dropping a shortcut into a known folder, and measuring or emptying
 * temp folders. A refusal never becomes an answer here — a failed existence check
 * leaves the path out instead of pruning a favourite.
 */
export function createFolderQueries(deps: FolderQueriesDeps) {
  const { absoluteForDrive, realAbsolutePath, callServerFs, lastCallError } = deps;

  async function missingFolders(paths: string[]): Promise<string[] | null> {
    if (paths.length === 0) return [];
    const answer = await callServerFs<{ existing?: string[]; unchecked?: string[] }>('exists', { paths });
    if (!answer || !Array.isArray(answer.existing)) return null;
    const existing = new Set(answer.existing.map((entry) => entry.toLowerCase()));
    const unchecked = new Set((answer.unchecked ?? []).map((entry) => entry.toLowerCase()));
    return paths.filter((entry) => !existing.has(entry.toLowerCase()) && !unchecked.has(entry.toLowerCase()));
  }

  function lastServerError(): string {
    return lastCallError();
  }

  /**
   * Sends an item to one of the user's folders: the desktop gets a shortcut,
   * every other destination a copy (the rule lives on the server). Returns the
   * final path, or null with `lastServerError` set.
   */
  async function sendTo(destination: SendToDestination, item: FileItem): Promise<string | null> {
    const result = await callServerFs<{ path?: string }>('sendto', {
      path: realAbsolutePath(item),
      destination,
    });
    return result?.path ?? null;
  }

  /** Same, into a folder the user picked in the dialog (a copy). */
  async function sendToFolder(driveId: string, folderPath: string, item: FileItem): Promise<string | null> {
    const result = await callServerFs<{ path?: string }>('sendto', {
      path: realAbsolutePath(item),
      destinationDir: absoluteForDrive(driveId, folderPath),
    });
    return result?.path ?? null;
  }

  /** The folders the cleanup menu may offer, with the paths the server owns. */
  async function listCleanupTargets(): Promise<CleanupTarget[] | null> {
    const result = await callServerFs<{ targets: CleanupTarget[] }>('cleanup/targets', {});
    return result?.targets ?? null;
  }

  /** Measures what emptying one cleanup folder would free, changing nothing. */
  async function scanCleanup(target: CleanupTargetId, minAgeDays: number): Promise<CleanupScan | null> {
    return callServerFs<CleanupScan>('cleanup/scan', { target, minAgeDays });
  }

  /**
   * Empties one cleanup folder, best effort: entries another program holds on to
   * are reported instead of failing the whole run. The server decides which
   * files those are; the renderer only chooses the folder and the age filter.
   */
  async function runCleanup(target: CleanupTargetId, minAgeDays: number): Promise<CleanupRun | null> {
    return callServerFs<CleanupRun>('cleanup/run', { target, minAgeDays });
  }

  return { missingFolders, sendTo, sendToFolder, listCleanupTargets, scanCleanup, runCleanup, lastServerError };
}
