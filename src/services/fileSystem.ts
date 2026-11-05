import { base64ToBytes } from './zipArchive';
import type { OpenableArchiveFormat } from './archiveBackend';
import { API_BASE } from './apiBase';
import { createArchiveOps, type ArchiveOps } from './fileArchiveOps';
import { createCatalogOps, type CatalogueState } from './fileCatalog';
import { createCopyMoveOps } from './fileCopyMove';
import { createTransferOps, type RealFsJob, type TransferOps } from './fileTransfer';
import type { OpenWithProgram } from './openWith';
import {
  ConflictResolution,
  Drive,
  DiskUsageItem,
  DiskUsageScan,
  FileItem,
  TreeSizeFailure,
  TreeSizeOptions,
  TreeSizeResult,
  FileProgressEntry,
  FreeSpaceReport,
  PendingConflict,
  RecycleBinItem,
  TransferOptions,
  TransferPlan,
  TransferPlanEntry,
} from '../types';
import { log } from '../utils/logger';
import { tGlobal } from '../i18n/translations';
import { fetchWithRetry, sessionTokenHeader } from '../utils/fetchWithRetry';
import { readCatalogue, writeCatalogue } from './filesystemStorage';

// The archive errors live with the format dispatch that raises them; they stay
// re-exported here because this module is the engine's public surface.
export { ArchivePasswordError, UnsupportedArchiveError } from './archiveBackend';
// The transfer policy lives with the poller now; tests still import it from here.
export { lostJobRetryPolicy } from './fileTransfer';
export type { ArchiveBackend, OpenableArchiveFormat } from './archiveBackend';
import { calculateFileHashes as calculateFileHashesImpl } from './fileSystemCrypto';

/** A cancelled request rejects with this name; that is not a scan failure. */
function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

/**
 * What a failed scan answer means. The server distinguishes a folder it cannot
 * read (403) from one that is gone (404). A 5xx is the server failing to answer
 * at all — in development the proxy turns a stopped server into exactly that —
 * and any other refusal is the server declining this path.
 */
function treeSizeFailureForStatus(status: number): TreeSizeFailure {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status >= 500) return 'unreachable';
  return 'refused';
}

/** One entry of a `/api/list` answer, as the server writes it. */
interface ServerListItem {
  name?: string;
  ext?: string;
  fullName?: string;
  isDirectory?: boolean;
  size?: number;
  modifiedAt?: string;
  createdAt?: string;
  attributes?: FileItem['attributes'];
  content?: string;
}

/** One line of the folder-size stream the server writes while it scans. */
interface ScanMessage {
  type?: 'progress' | 'folder' | 'done' | 'error';
  entries?: number;
  files?: number;
  dirs?: number;
  bytes?: number;
  currentPath?: string;
  elapsedMs?: number;
  folder?: DiskUsageItem;
  tree?: DiskUsageScan;
  error?: string;
}

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
 * Bound on the in-memory listing cache. Every directory ever listed used to
 * accumulate forever, and the whole array is JSON-persisted, so a long session
 * eventually blew the localStorage quota. The cache now keeps at most this many
 * directory buckets, evicting the least-recently-used ones; a directory the user
 * returns to simply reloads from the server. Exposed so tests can shrink it.
 */
export const listingCachePolicy = {
  /** Maximum distinct directory buckets retained in memory. */
  maxCachedDirectories: 200,
};

// Initial Virtual Drives
export const initialDrives: Drive[] = [];

// Initial Virtual Files & Folders
export const initialFiles: FileItem[] = [];
class FileSystemEngine {
  private drives: Drive[] = [];
  private state: CatalogueState = { files: [], recycleBin: [] };
  private listeners: Array<() => void> = [];

  private storageSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Index of files by `${driveId}|${normalizedPath}` for O(1) getFiles lookups.
  private filesVersion = 0;
  private filesIndexVersion = -1;
  private filesIndex = new Map<string, FileItem[]>();

  // Least-recently-used order of directory buckets (`driveId|normalizedPath`).
  // A Map preserves insertion order, so re-inserting a key on access moves it to
  // the most-recent end; the front is then the eviction candidate.
  private bucketOrder = new Map<string, true>();

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushStorage());
    }
  }

  private loadFromStorage() {
    // Real drives only: a first run has nothing saved, and virtual drives are
    // added elsewhere on purpose. A value that cannot be read means the same
    // thing here as no value at all, which is what the reader already decides.
    const catalogue = readCatalogue();
    this.drives = catalogue.drives;
    this.state.files = catalogue.files;
    this.state.recycleBin = catalogue.recycleBin;
  }

  /**
   * Serializes only the fields the UI actually needs. `content` (inline text or
   * base64 payloads) is the heavy, non-visible field that used to blow the
   * localStorage quota; a directory listing reloads it from the server, and
   * virtual files rehydrate lazily. Kept explicit so a future field is a
   * deliberate decision rather than an accidental quota regression.
   */
  private filesForStorage(): Array<Omit<FileItem, 'content'>> {
    return this.state.files.map((f) => ({
      id: f.id,
      name: f.name,
      ext: f.ext,
      fullName: f.fullName,
      path: f.path,
      driveId: f.driveId,
      isDirectory: f.isDirectory,
      size: f.size,
      modifiedAt: f.modifiedAt,
      createdAt: f.createdAt,
      attributes: f.attributes,
      mimeType: f.mimeType,
      icon: f.icon,
      isLocked: f.isLocked,
    }));
  }

  private persistToStorageNow() {
    if (typeof window === 'undefined') return;
    const saved = writeCatalogue({
      drives: this.drives,
      files: this.filesForStorage(),
      recycleBin: this.state.recycleBin,
    });
    if (!saved) {
      // A quota-exceeded write used to fail silently, so the user lost drives,
      // files and trash with no trace. Log it and keep the app running on the
      // in-memory state instead of pretending the save succeeded.
      log.error('[fileSystem] persist to localStorage failed; continuing in memory');
    }
  }

  public flushStorage() {
    if (this.storageSaveTimer) {
      clearTimeout(this.storageSaveTimer);
      this.storageSaveTimer = null;
      this.persistToStorageNow();
    }
  }

  public saveToStorage() {
    // Notify React immediately; debounce the expensive localStorage writes.
    this.filesVersion++;
    this.notify();
    if (typeof window === 'undefined') return;
    if (this.storageSaveTimer) {
      clearTimeout(this.storageSaveTimer);
    }
    this.storageSaveTimer = setTimeout(() => {
      this.persistToStorageNow();
      this.storageSaveTimer = null;
    }, 250);
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public getDrives(): Drive[] {
    return [...this.drives];
  }

  /**
   * Reads one directory from disk into the catalogue. Resolves `true` when the
   * server listed it, `false` when it refused or could not be reached: callers
   * that offer the folder as a destination need to tell "empty" from "gone".
   */
  public async loadSystemDriveDirectory(driveId: string, path: string): Promise<boolean> {
    if (this.getArchiveSource(driveId, path)) return false;
    try {
      const response = await fetchWithRetry(
        `${API_BASE}/api/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(path)}`,
        { timeoutMs: 10000, retries: 2 },
      );
      if (!response.ok) return false;
      const serverItems = await response.json();
      if (!Array.isArray(serverItems)) return false;

      const normPath = this.normalizePath(path);
      const untouched = this.state.files.filter(
        (f) => !(f.driveId === driveId && this.normalizePath(f.path) === normPath),
      );
      const mapped: FileItem[] = serverItems.map((item: ServerListItem, index: number) => ({
        id: `sys_${driveId}_${index}_${Date.now()}`,
        name: item.name ?? '',
        ext: item.ext || '',
        fullName: item.fullName || undefined,
        path: normPath,
        driveId,
        isDirectory: !!item.isDirectory,
        size: Number(item.size) || 0,
        modifiedAt: item.modifiedAt || '',
        createdAt: item.createdAt || '',
        attributes: item.attributes || {
          readOnly: false,
          hidden: String(item.name || '').startsWith('.'),
          system: false,
          archive: !item.isDirectory,
        },
        content: item.content || '',
      }));

      this.state.files = [...untouched, ...mapped];
      this.touchBucket(driveId, normPath);
      this.saveToStorage();
      return true;
    } catch (e) {
      log.warn('Could not list system directory', path, e);
      return false;
    }
  }

  public getSearchIndex(searchAllDrives: boolean = false, currentDriveId: string = ''): FileItem[] {
    // Centralized indexed access instead of reaching private internals.
    const files = [...this.state.files];
    if (searchAllDrives) return files;
    return files.filter((file) => file.driveId === currentDriveId);
  }

  public setDrives(next: Drive[]) {
    this.drives = Array.isArray(next) ? next : [];
    this.saveToStorage();
  }

  /**
   * Stable field signature used to detect real drive-list changes across
   * polls: an unchanged machine must cost one fetch and nothing else.
   */
  private driveSignature(drive: Drive): string {
    return [
      drive.id,
      drive.letter,
      drive.name,
      drive.type,
      drive.driveKind || '',
      drive.fileSystem || '',
      drive.serialNumber || '',
      drive.description || '',
      String(drive.totalBytes),
      String(drive.freeBytes),
      drive.isMounted ? 1 : 0,
      drive.readOnly ? 1 : 0,
    ].join('|');
  }

  /**
   * Refresh the real drive list from the local server. The app polls this so a
   * USB device plugged in after startup shows up without a restart. Subscribers
   * and storage are only touched when the list actually changed.
   * Resolves `true` when the server answered, `false` when it did not.
   *
   * `signal` lets the caller abandon the poll when it unmounts. The read is then
   * cancelled instead of retrying, and the failure is not logged: a diagnostic
   * for a window that no longer exists is what used to escape after unmount and
   * race the test worker's teardown.
   */
  public async loadRealDrivesFromApi(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/drives`, {
        timeoutMs: 10000,
        retries: 2,
        signal: options.signal,
      });
      if (!response.ok) return false;
      const data = await response.json();
      if (!Array.isArray(data)) return false;
      const next = data as Drive[];
      const changed =
        next.length !== this.drives.length ||
        next.some((d, i) => this.driveSignature(d) !== this.driveSignature(this.drives[i]));
      if (changed) {
        this.setDrives(next);
      }
      return true;
    } catch (e) {
      if (!options.signal?.aborted) log.warn('Could not load real drives from API', e);
      return false;
    }
  }

  public getDrive(driveId: string): Drive | undefined {
    return this.drives.find((d) => d.id === driveId);
  }

  public getDriveByLetter(letter: string): Drive | undefined {
    const formatted = letter.endsWith(':') ? letter : `${letter}:`;
    return this.drives.find((d) => d.letter.toUpperCase() === formatted.toUpperCase());
  }

  public getFiles(driveId: string, currentPath: string): FileItem[] {
    const mount = this.archiveOps.findArchive(driveId, currentPath);
    if (mount) return mount.items.filter((item) => this.normalizePath(item.path) === this.normalizePath(currentPath));
    if (this.filesIndexVersion !== this.filesVersion) {
      this.filesIndex.clear();
      for (const f of this.state.files) {
        const key = `${f.driveId}|${this.normalizePath(f.path)}`;
        const bucket = this.filesIndex.get(key);
        if (bucket) bucket.push(f);
        else this.filesIndex.set(key, [f]);
      }
      this.filesIndexVersion = this.filesVersion;
    }
    const key = `${driveId}|${this.normalizePath(currentPath)}`;
    // Reading a bucket marks it as recently used, so the LRU evicts what the
    // user has actually stopped looking at.
    if (this.bucketOrder.has(key)) {
      this.bucketOrder.delete(key);
      this.bucketOrder.set(key, true);
    }
    return this.filesIndex.get(key) || [];
  }

  /** Trash and other virtual entries live only in memory, so the LRU never drops them. */
  private bucketEvictable(key: string): boolean {
    return key.startsWith('real_');
  }

  /**
   * Records a directory bucket as recently used and evicts the least-recently-used
   * real-drive buckets past the cap. Virtual/trash buckets are exempt: they have no
   * server-side listing to reload from.
   */
  private touchBucket(driveId: string, path: string) {
    const key = `${driveId}|${this.normalizePath(path)}`;
    this.bucketOrder.delete(key);
    this.bucketOrder.set(key, true);

    const evictable = [...this.bucketOrder.keys()].filter((k) => this.bucketEvictable(k));
    if (evictable.length <= listingCachePolicy.maxCachedDirectories) return;

    const overBy = evictable.length - listingCachePolicy.maxCachedDirectories;
    const doomed = new Set(evictable.slice(0, overBy));
    if (doomed.size === 0) return;

    this.bucketOrder = new Map([...this.bucketOrder].filter(([k]) => !doomed.has(k)));
    this.state.files = this.state.files.filter((f) => !doomed.has(`${f.driveId}|${this.normalizePath(f.path)}`));
  }

  public getFileById(id: string): FileItem | undefined {
    return this.state.files.find((f) => f.id === id) || this.archiveOps.findMountedItem(id);
  }

  public normalizePath(path: string): string {
    if (!path) return '';
    let p = path.replace(/\//g, '\\').trim();
    // Normalize drive root to always have a trailing backslash: "C:" -> "C:\"
    if (/^[A-Z]:$/i.test(p)) p += '\\';
    // remove trailing slash unless it's just "C:\"
    if (p.endsWith('\\') && p.length > 3) {
      p = p.slice(0, -1);
    }
    return p;
  }

  public getParentPath(path: string): string {
    const norm = this.normalizePath(path);
    // Drive root (e.g. "C:\") — cannot navigate above it.
    if (/^[A-Z]:\\$/i.test(norm)) return '';
    const lastSlash = norm.lastIndexOf('\\');
    if (lastSlash <= 2) {
      // Direct child of drive root (e.g. "C:\folder" -> "C:\")
      return norm.substring(0, 3);
    }
    return norm.substring(0, lastSlash);
  }

  // -----------------------------------------------------------------------
  // Real-drive bridge
  // -----------------------------------------------------------------------
  // A browser renderer cannot write to arbitrary paths (the File System Access
  // API needs a user-granted handle per root), so any mutation on a "real_*"
  // drive is executed by the local server, which has full filesystem access.
  // After the server confirms, the affected directory is re-listed from disk
  // so the UI reflects the real state instead of an optimistic guess.

  isSystemDrive(driveId: string): boolean {
    return !!driveId && driveId.startsWith('real_');
  }

  // Display splits `name`/`ext`; the on-disk name is what actually has to be
  // addressed, and for directories it is always the untouched original.
  private realEntryName(file: FileItem): string {
    if (file.fullName) return file.fullName;
    if (file.isDirectory) return file.name;
    return file.ext ? `${file.name}.${file.ext}` : file.name;
  }

  /**
   * Drive letter a real-drive id stands for: `real_C` -> `C:`. Panels hold their
   * location relative to the drive ("Users\\name"), but the server accepts only
   * drive-letter absolute paths, so the letter has to be put back before a call.
   */
  private driveLetterOf(driveId: string): string {
    const match = /^real_([A-Za-z])$/.exec(driveId);
    return match ? `${match[1].toUpperCase()}:` : '';
  }

  /** Absolute on-disk form of a real-drive path, which the panels keep relative. */
  private absoluteForDrive(driveId: string, targetPath: string): string {
    const normalized = this.normalizePath(targetPath);
    if (/^[A-Za-z]:/.test(normalized)) return normalized;
    const letter = this.driveLetterOf(driveId);
    if (!letter) return normalized;
    return this.normalizePath(normalized ? `${letter}\\${normalized}` : letter);
  }

  private realAbsolutePath(file: FileItem): string {
    const parent = this.absoluteForDrive(file.driveId, file.path);
    const trimmed = parent.endsWith('\\') ? parent.slice(0, -1) : parent;
    return `${trimmed}\\${this.realEntryName(file)}`;
  }

  private childAbsolutePath(parentPath: string, childName: string): string {
    const parent = this.normalizePath(parentPath);
    const trimmed = parent.endsWith('\\') ? parent.slice(0, -1) : parent;
    return `${trimmed}\\${childName}`;
  }

  /**
   * Last real reason a server call failed. `callServerFs` deliberately returns
   * null instead of throwing because some callers fire it as `void`, so the
   * diagnostic has to be carried out of band. Callers that must report the
   * failure read this instead of inventing a generic message.
   */
  private lastCallError = '';

  /**
   * Which of these absolute folders still exist. The tree pins folders by path,
   * so a folder deleted outside the app has to be noticed rather than clicked.
   *
   * Resolves null when the server could not answer at all, and leaves the paths
   * it refused to judge out of `missing`: a caller must never prune a favourite
   * over a failed request or a permissions error.
   */
  public async missingFolders(paths: string[]): Promise<string[] | null> {
    if (paths.length === 0) return [];
    const answer = await this.callServerFs<{ existing?: string[]; unchecked?: string[] }>('exists', { paths });
    if (!answer || !Array.isArray(answer.existing)) return null;
    const existing = new Set(answer.existing.map((entry) => entry.toLowerCase()));
    const unchecked = new Set((answer.unchecked ?? []).map((entry) => entry.toLowerCase()));
    return paths.filter((entry) => !existing.has(entry.toLowerCase()) && !unchecked.has(entry.toLowerCase()));
  }

  private async callServerFs<T>(route: string, body: unknown): Promise<T | null> {
    this.lastCallError = '';
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/fs/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        timeoutMs: 20000,
        retries: 0,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        log.warn('Real filesystem request rejected', route, detail);
        this.lastCallError = detail?.error
          ? String(detail.error)
          : `Server rejected ${route} (HTTP ${response.status})`;
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      log.warn('Real filesystem request failed', route, error);
      this.lastCallError = error instanceof Error ? error.message : `Request ${route} failed`;
      return null;
    }
  }

  /**
   * Why the last real server call failed, empty when it succeeded.
   * `callServerFs` returns null instead of throwing, so a caller that must show
   * a reason ("needs administrator rights") reads it here.
   */
  get lastServerError(): string {
    return this.lastCallError;
  }

  /**
   * Sends an item to one of the user's folders: the desktop gets a shortcut,
   * every other destination a copy (the rule lives on the server). Returns the
   * final path, or null with `lastServerError` set.
   */
  async sendTo(destination: SendToDestination, item: FileItem): Promise<string | null> {
    const result = await this.callServerFs<{ path?: string }>('sendto', {
      path: this.realAbsolutePath(item),
      destination,
    });
    return result?.path ?? null;
  }

  /** Same, into a folder the user picked in the dialog (a copy). */
  async sendToFolder(driveId: string, folderPath: string, item: FileItem): Promise<string | null> {
    const result = await this.callServerFs<{ path?: string }>('sendto', {
      path: this.realAbsolutePath(item),
      destinationDir: this.absoluteForDrive(driveId, folderPath),
    });
    return result?.path ?? null;
  }

  /** The folders the cleanup menu may offer, with the paths the server owns. */
  async listCleanupTargets(): Promise<CleanupTarget[] | null> {
    const result = await this.callServerFs<{ targets: CleanupTarget[] }>('cleanup/targets', {});
    return result?.targets ?? null;
  }

  /** Measures what emptying one cleanup folder would free, changing nothing. */
  async scanCleanup(target: CleanupTargetId, minAgeDays: number): Promise<CleanupScan | null> {
    return this.callServerFs<CleanupScan>('cleanup/scan', { target, minAgeDays });
  }

  /**
   * Empties one cleanup folder, best effort: entries another program holds on to
   * are reported instead of failing the whole run. The server decides which
   * files those are; the renderer only chooses the folder and the age filter.
   */
  async runCleanup(target: CleanupTargetId, minAgeDays: number): Promise<CleanupRun | null> {
    return this.callServerFs<CleanupRun>('cleanup/run', { target, minAgeDays });
  }

  // -------------------------------------------------------------------------
  // Server-side transfers
  // -------------------------------------------------------------------------

  /**
   * The transfer layer, built the first time a job starts.
   *
   * Starting a job, following it, mirroring pause/cancel onto the server and
   * raising one collision prompt per destination used to be ~270 lines of this
   * class. It lives in `fileTransfer` now; what it needs from here is the
   * catalogue after the transfer and nothing else, and that arrives named.
   */
  private transferOpsInstance: TransferOps | null = null;

  private get transferOps(): TransferOps {
    this.transferOpsInstance ??= createTransferOps({
      callServerFs: (route, body) => this.callServerFs(route, body),
      lastCallError: () => this.lastCallError,
      normalizePath: (path) => this.normalizePath(path),
      realAbsolutePath: (file) => this.realAbsolutePath(file),
      realEntryName: (file) => this.realEntryName(file),
      isSystemDrive: (driveId) => this.isSystemDrive(driveId),
      loadSystemDriveDirectory: (driveId, path) => this.loadSystemDriveDirectory(driveId, path),
      catalogueEntryAt: (driveId, path, name) => this.catalogueEntryAt(driveId, path, name),
    });
    return this.transferOpsInstance;
  }

  /** The catalogue entry that landed in a folder, after the server re-listed it. */
  private catalogueEntryAt(driveId: string, path: string, name: string): FileItem | undefined {
    const normTarget = this.normalizePath(path);
    return this.state.files.find(
      (candidate) =>
        candidate.driveId === driveId &&
        this.normalizePath(candidate.path) === normTarget &&
        this.realEntryName(candidate) === name,
    );
  }

  private async awaitServerJob(
    jobId: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onJob?: (job: RealFsJob) => void,
    onConflict?: (conflict: PendingConflict) => void,
  ): Promise<RealFsJob | null> {
    return this.transferOps.awaitServerJob(jobId, onProgress, signal, onJob, onConflict);
  }

  public async resolveConflict(jobId: string, action: ConflictResolution, applyToAll: boolean): Promise<void> {
    return this.transferOps.resolveConflict(jobId, action, applyToAll);
  }

  public async cancelJob(jobId: string): Promise<void> {
    return this.transferOps.cancelJob(jobId);
  }

  public async setJobThrottle(jobId: string, throttleBps: number): Promise<void> {
    return this.transferOps.setJobThrottle(jobId, throttleBps);
  }

  private runRealJob(route: string, body: unknown, driveId: string, reloadPath: string): void {
    this.transferOps.runRealJob(route, body, driveId, reloadPath);
  }

  public async transferPaths(
    op: 'copy' | 'move',
    sources: string[],
    targetDir: string,
    overwrite: boolean,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
    onStart?: (info: { totalBytes: number; itemsTotal: number; jobId: string }) => void,
  ): Promise<void> {
    return this.transferOps.transferPaths(
      op,
      sources,
      targetDir,
      overwrite,
      onProgress,
      signal,
      options,
      onConflict,
      onFiles,
      onStart,
    );
  }

  private async realCopyOrMove(
    file: FileItem,
    op: 'copy' | 'move',
    targetDriveId: string,
    targetPath: string,
    overwrite: boolean,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<FileItem | undefined> {
    return this.transferOps.realCopyOrMove(
      file,
      op,
      targetDriveId,
      targetPath,
      overwrite,
      onProgress,
      signal,
      options,
      onConflict,
      onFiles,
    );
  }
  /**
   * Absolute on-disk path of a real-drive entry, for callers that need to record
   * or replay a transfer without holding the in-memory catalogue entry.
   */
  public absolutePathOf(file: FileItem): string {
    return this.realAbsolutePath(file);
  }

  /** True when the entry lives on a real drive and is written by the server. */
  public isRealFile(file: FileItem): boolean {
    return !file.archiveRoot && this.isSystemDrive(file.driveId);
  }

  /**
   * Absolute path of a file the server owns, for the browser to load on its own
   * (the thumbnail grid, the preview and the media player all need a URL).
   * A virtual entry has no such path, and a folder has no bytes to serve.
   */
  public absolutePathFor(file: FileItem): string | null {
    if (file.isDirectory || !this.isRealFile(file)) return null;
    return this.realAbsolutePath(file);
  }

  /**
   * Hands one file to the Windows "Open with" chooser, so it can be opened by a
   * program that is not the registered default. The dialog belongs to the shell,
   * not to this app: this only asks for it for a path the server validated.
   */
  public async openWith(file: FileItem): Promise<boolean> {
    const absolute = this.absolutePathFor(file);
    if (!absolute) return false;
    const response = await fetchWithRetry(`${API_BASE}/api/open-with`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absolute }),
      timeoutMs: 20000,
      retries: 0,
    });
    return response.ok;
  }

  /**
   * The programs registered for this file's extension, for the submenu. An empty
   * list is normal (a type nothing claims), so a refusal is not an error here:
   * the menu then offers only the shell's own chooser.
   */
  public async openWithPrograms(file: FileItem): Promise<OpenWithProgram[]> {
    const absolute = this.absolutePathFor(file);
    if (!absolute) return [];
    const response = await fetchWithRetry(`${API_BASE}/api/open-with/programs?path=${encodeURIComponent(absolute)}`, {
      timeoutMs: 15000,
      retries: 0,
    });
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => ({}))) as { programs?: OpenWithProgram[] };
    return Array.isArray(payload.programs) ? payload.programs : [];
  }

  /** Opens one file with one of the programs the submenu listed. */
  public async openWithProgram(file: FileItem, program: string): Promise<boolean> {
    const absolute = this.absolutePathFor(file);
    if (!absolute || !program) return false;
    const response = await fetchWithRetry(`${API_BASE}/api/open-with/app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absolute, program }),
      timeoutMs: 20000,
      retries: 0,
    });
    return response.ok;
  }

  /**
   * Saves the transfer list on disk. Returns the file that was written, or null
   * when the server could not be reached.
   */
  public async saveCopyList(plans: TransferPlan[], path?: string): Promise<{ path: string; saved: number } | null> {
    return this.callServerFs<{ path: string; saved: number }>('copylist/save', {
      list: plans,
      path: path || undefined,
    });
  }

  /**
   * Reads a saved transfer list from disk. A missing file is an empty list, not
   * an error: there is simply nothing to replay yet.
   */
  public async loadCopyList(path?: string): Promise<{ path: string; list: TransferPlan[]; found: boolean } | null> {
    return this.callServerFs<{ path: string; list: TransferPlan[]; found: boolean }>('copylist/load', {
      path: path || undefined,
    });
  }

  /**
   * Sizes paths that came from the native picker instead of a listing. Folders
   * come back with 0 bytes because the transfer job measures the tree itself;
   * `missing` carries the paths the server could not stat.
   */
  public async inspectPaths(
    paths: string[],
  ): Promise<{ entries: TransferPlanEntry[]; missing: Array<{ path: string; reason: string }> } | null> {
    if (paths.length === 0) return { entries: [], missing: [] };
    return this.callServerFs<{ entries: TransferPlanEntry[]; missing: Array<{ path: string; reason: string }> }>(
      'stat',
      {
        paths,
      },
    );
  }

  /**
   * Measures what a set of plans will write and how much room each target
   * volume has left. The server walks the folder trees, which the renderer
   * cannot do, so `size` here is the same number the job will report.
   */
  public async checkFreeSpace(plans: TransferPlan[]): Promise<FreeSpaceReport | null> {
    const usable = plans.filter((plan) => plan.entries.length > 0);
    if (usable.length === 0) return { volumes: [] };
    return this.callServerFs<FreeSpaceReport>('freespace', {
      plans: usable.map((plan) => ({
        targetDir: plan.targetDir,
        // The operation matters: a move inside one volume is a rename and needs
        // no room, so reporting it as a copy would block a safe transfer.
        op: plan.op,
        sources: plan.entries.map((entry) => entry.path),
      })),
    });
  }

  // -----------------------------------------------------------------------
  // Catalogue writes
  // -----------------------------------------------------------------------

  /**
   * Creating, renaming, deleting and trashing entries, built on first write.
   *
   * The methods below keep their public shape, so no caller changes; the bodies
   * moved to `fileCatalog` with the rules they enforce. Lazy because the path
   * helpers it receives only exist once the class has finished building itself.
   */
  private catalogOpsInstance: ReturnType<typeof createCatalogOps> | null = null;

  private get catalogOps(): ReturnType<typeof createCatalogOps> {
    this.catalogOpsInstance ??= createCatalogOps({
      state: this.state,
      normalizePath: (path) => this.normalizePath(path),
      isSystemDrive: (driveId) => this.isSystemDrive(driveId),
      absoluteForDrive: (driveId, targetPath) => this.absoluteForDrive(driveId, targetPath),
      childAbsolutePath: (parentPath, childName) => this.childAbsolutePath(parentPath, childName),
      realAbsolutePath: (file) => this.realAbsolutePath(file),
      getArchiveSource: (driveId, path) => this.getArchiveSource(driveId, path),
      getFileById: (id) => this.getFileById(id),
      runRealJob: (route, body, driveId, reloadPath) => this.runRealJob(route, body, driveId, reloadPath),
      callServerFs: (route, body) => this.callServerFs(route, body),
      awaitServerJob: (jobId, onProgress, signal, onJob) => this.awaitServerJob(jobId, onProgress, signal, onJob),
      lastCallError: () => this.lastCallError,
      saveToStorage: () => this.saveToStorage(),
      loadSystemDriveDirectory: (driveId, path) => this.loadSystemDriveDirectory(driveId, path),
    });
    return this.catalogOpsInstance;
  }

  public createDirectory(driveId: string, parentPath: string, dirName: string): FileItem {
    return this.catalogOps.createDirectory(driveId, parentPath, dirName);
  }

  public createFile(driveId: string, parentPath: string, fileName: string, content: string = ''): FileItem {
    return this.catalogOps.createFile(driveId, parentPath, fileName, content);
  }

  public saveFileContent(fileId: string, content: string) {
    this.catalogOps.saveFileContent(fileId, content);
  }

  public renameItem(fileId: string, newFullName: string) {
    this.catalogOps.renameItem(fileId, newFullName);
  }

  public deleteItem(fileId: string, useRecycleBin: boolean = false) {
    this.catalogOps.deleteItem(fileId, useRecycleBin);
  }

  public async deleteItems(
    items: FileItem[],
    useRecycleBin: boolean,
    onProgress?: (done: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<void> {
    await this.catalogOps.deleteItems(items, useRecycleBin, onProgress, signal, onFiles);
  }

  public moveToRecycleBin(fileId: string): boolean {
    return this.catalogOps.moveToRecycleBin(fileId);
  }

  public restoreFromRecycleBin(recycleBinItemId: string): boolean {
    return this.catalogOps.restoreFromRecycleBin(recycleBinItemId);
  }

  public emptyRecycleBin() {
    this.catalogOps.emptyRecycleBin();
  }

  public getRecycleBinItems(): RecycleBinItem[] {
    return this.catalogOps.getRecycleBinItems();
  }

  public deletePermanentlyFromRecycleBin(recycleBinItemId: string) {
    this.catalogOps.deletePermanentlyFromRecycleBin(recycleBinItemId);
  }

  /**
   * Copy and move inside the catalogue, built on first use.
   *
   * The public methods keep their shape; the bodies moved to `fileCopyMove` with
   * the rule they encode — collect the children before writing, because a folder
   * copied into itself used to duplicate whatever it had just pushed.
   */
  private copyMoveOpsInstance: ReturnType<typeof createCopyMoveOps> | null = null;

  private get copyMoveOps(): ReturnType<typeof createCopyMoveOps> {
    this.copyMoveOpsInstance ??= createCopyMoveOps({
      state: this.state,
      normalizePath: (path) => this.normalizePath(path),
      isSystemDrive: (driveId) => this.isSystemDrive(driveId),
      getArchiveSource: (driveId, path) => this.getArchiveSource(driveId, path),
      getFileById: (id) => this.getFileById(id),
      extractArchive: (archiveFile, targetDriveId, targetPath, selectedEntry) =>
        this.extractArchive(archiveFile, targetDriveId, targetPath, selectedEntry),
      realCopyOrMove: (
        file,
        op,
        targetDriveId,
        targetPath,
        overwrite,
        onProgress,
        signal,
        options,
        onConflict,
        onFiles,
      ) =>
        this.realCopyOrMove(
          file,
          op,
          targetDriveId,
          targetPath,
          overwrite,
          onProgress,
          signal,
          options,
          onConflict,
          onFiles,
        ),
      saveToStorage: () => this.saveToStorage(),
    });
    return this.copyMoveOpsInstance;
  }

  public async copyItem(
    fileId: string,
    targetDriveId: string,
    targetPath: string,
    overwrite: boolean = true,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<FileItem | undefined> {
    return this.copyMoveOps.copyItem(
      fileId,
      targetDriveId,
      targetPath,
      overwrite,
      onProgress,
      signal,
      options,
      onConflict,
      onFiles,
    );
  }

  public async moveItem(
    fileId: string,
    targetDriveId: string,
    targetPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<boolean> {
    return this.copyMoveOps.moveItem(
      fileId,
      targetDriveId,
      targetPath,
      onProgress,
      signal,
      options,
      onConflict,
      onFiles,
    );
  }

  // Cryptographic Hash Calculator (MD5 approximation + real Web Crypto SHA-1 & SHA-256)
  public async calculateFileHashes(file: FileItem): Promise<{ md5: string; sha1: string; sha256: string }> {
    return calculateFileHashesImpl(file);
  }

  /**
   * Raw bytes of a file. `maxBytes` caps what comes back and is forwarded to the
   * server as well, so a caller that only needs a preview (the viewer and the
   * editor) never drags a huge file into memory. Omitting it asks for the whole
   * file, which the server only serves while the file fits its own limit and
   * refuses with a 413 past it; `unlimited` is for the archive engine, which
   * cannot parse an archive it only half received.
   */
  public async readFileBytes(
    file: FileItem,
    options?: { maxBytes?: number; unlimited?: boolean },
  ): Promise<Uint8Array> {
    const maxBytes = options?.maxBytes;
    const cap = (bytes: Uint8Array): Uint8Array =>
      maxBytes && bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes;

    if (file.archiveRoot && file.archiveEntry) {
      const mount = this.archiveOps.findArchive(file.driveId, file.archiveRoot);
      if (!mount) throw new Error(tGlobal('zipErrEmpty'));
      return cap(await mount.backend.readEntry(file.archiveEntry));
    }
    if (this.isSystemDrive(file.driveId)) {
      const response = await fetchWithRetry(`${API_BASE}/api/fs/read-bytes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: this.realAbsolutePath(file),
          maxBytes,
          unlimited: options?.unlimited === true,
        }),
        retries: 0,
        timeoutMs: 120000,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      return cap(new Uint8Array(await response.arrayBuffer()));
    }
    if (file.contentEncoding === 'base64' || file.ext.toUpperCase() === 'ZIP') {
      return cap(base64ToBytes(file.content || ''));
    }
    return cap(new TextEncoder().encode(file.content || ''));
  }

  /**
   * Machine facts the command bar reports.
   *
   * `ipconfig`, `tasklist` and `tree` used to answer with canned text written
   * into the translation tables, so a command printed a plausible machine that
   * was not this one. The three reads below ask the server, which is the only
   * process that can see the interfaces, the process list and the real folders.
   */
  public async getNetworkAdapters(): Promise<{ name: string; address: string; netmask: string; internal: boolean }[]> {
    const response = await fetchWithRetry(`${API_BASE}/api/net/adapters`, { timeoutMs: 10000, retries: 0 });
    if (!response.ok) throw new Error((await response.json()).error);
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  }

  public async getProcesses(): Promise<{ pid: number; name: string; memoryKb: number }[]> {
    // Longer than the server's own budget: the client must wait for a verdict
    // instead of abandoning a read that was still running.
    const response = await fetchWithRetry(`${API_BASE}/api/processes`, { timeoutMs: 210000, retries: 0 });
    if (!response.ok) throw new Error((await response.json()).error);
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  }

  public async getFolderTree(
    driveId: string,
    folderPath: string,
    depth = 2,
  ): Promise<{ path: string; entries: { name: string; depth: number }[]; unreadable: string[]; truncated: boolean }> {
    const query = new URLSearchParams({ driveId, path: folderPath, depth: String(depth) });
    const response = await fetchWithRetry(`${API_BASE}/api/tree?${query.toString()}`, {
      timeoutMs: 30000,
      retries: 0,
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
  }

  // -------------------------------------------------------------------------
  // Archives
  // -------------------------------------------------------------------------

  /**
   * The archive subsystem, built the first time something needs it.
   *
   * Mounting, creating and extracting an archive used to be a 340-line block of
   * this class that reached into eighteen of its members: path arithmetic, the
   * catalogue index, the server bridge and the directory re-list. It lives in
   * `fileArchiveOps` now, and the dependencies it is handed below are named one
   * by one, so what it needs is visible in its signature instead of hidden in
   * `this`. Lazy on purpose: several of those members only exist once this
   * class has finished building itself.
   */
  private archiveOpsInstance: ArchiveOps | null = null;

  private get archiveOps(): ArchiveOps {
    this.archiveOpsInstance ??= createArchiveOps({
      normalizePath: (path) => this.normalizePath(path),
      getParentPath: (path) => this.getParentPath(path),
      childAbsolutePath: (parentPath, childName) => this.childAbsolutePath(parentPath, childName),
      absoluteForDrive: (driveId, targetPath) => this.absoluteForDrive(driveId, targetPath),
      realAbsolutePath: (file) => this.realAbsolutePath(file),
      realEntryName: (file) => this.realEntryName(file),
      isSystemDrive: (driveId) => this.isSystemDrive(driveId),
      getFiles: (driveId, currentPath) => this.getFiles(driveId, currentPath),
      readFileBytes: (file, options) => this.readFileBytes(file, options),
      createDirectory: (driveId, parentPath, dirName) => this.createDirectory(driveId, parentPath, dirName),
      callServerFs: (route, body) => this.callServerFs(route, body),
      lastCallError: () => this.lastCallError,
      rememberFile: (item) => this.rememberFile(item),
      saveToStorage: () => this.saveToStorage(),
      loadSystemDriveDirectory: (driveId, path) => this.loadSystemDriveDirectory(driveId, path),
    });
    return this.archiveOpsInstance;
  }

  /** Adds a catalogue entry and persists it, which is what a written file is. */
  private rememberFile(item: FileItem): void {
    this.state.files.push(item);
    this.saveToStorage();
  }

  public getArchiveSource(driveId: string, path: string): FileItem | undefined {
    return this.archiveOps.getArchiveSource(driveId, path);
  }

  public async openArchive(source: FileItem, password?: string): Promise<string> {
    return this.archiveOps.openArchive(source, password);
  }

  public async createArchive(
    items: FileItem[],
    archiveName: string,
    targetDriveId: string,
    targetPath: string,
    format: OpenableArchiveFormat = 'ZIP',
  ): Promise<FileItem> {
    return this.archiveOps.createArchive(items, archiveName, targetDriveId, targetPath, format);
  }

  public async extractArchive(
    archiveFile: FileItem,
    targetDriveId: string,
    targetPath: string,
    selectedEntry?: string,
  ): Promise<number> {
    return this.archiveOps.extractArchive(archiveFile, targetDriveId, targetPath, selectedEntry);
  }

  // Import external real file from browser input
  public async importBrowserFile(file: File, targetDriveId: string, targetPath: string): Promise<FileItem> {
    return this.archiveOps.writeBytes(targetDriveId, targetPath, file.name, new Uint8Array(await file.arrayBuffer()));
  }

  // File Splitter (Splits file into .part001, .part002, etc.)
  public splitFile(fileId: string, chunkSizeBytes: number, targetDriveId: string, targetPath: string): FileItem[] {
    const file = this.state.files.find((f) => f.id === fileId);
    if (!file || file.isDirectory) {
      throw new Error(tGlobal('fsSplitNoFile'));
    }

    const content = file.content || '';
    const totalSize = file.size || content.length || 1;
    const numChunks = Math.max(1, Math.ceil(totalSize / chunkSizeBytes));
    const createdParts: FileItem[] = [];

    const normTarget = this.normalizePath(targetPath);
    const baseName = `${file.name}${file.ext ? '.' + file.ext : ''}`;

    for (let i = 1; i <= numChunks; i++) {
      const extNum = i.toString().padStart(3, '0');
      const chunkName = `${baseName}.part${extNum}`;

      const chunkLen = Math.ceil(content.length / numChunks);
      const start = (i - 1) * chunkLen;
      const chunkContent = content.substring(start, start + chunkLen);
      const chunkSize = Math.min(chunkSizeBytes, Math.max(1, Math.ceil(totalSize / numChunks)));

      const created = this.createFile(targetDriveId, normTarget, chunkName, chunkContent);
      created.size = chunkSize;
      createdParts.push(created);
    }

    this.saveToStorage();
    return createdParts;
  }

  // File Joiner (Joins .part001, .part002, etc. into reconstructed file)
  public joinFiles(firstChunkId: string, targetDriveId: string, targetPath: string): FileItem {
    const firstChunk = this.state.files.find((f) => f.id === firstChunkId);
    if (!firstChunk) {
      throw new Error(tGlobal('fsJoinNoPart'));
    }

    const fullName = `${firstChunk.name}${firstChunk.ext ? '.' + firstChunk.ext : ''}`;
    const match = fullName.match(/^(.*)\.part(\d+)$/i);
    if (!match) {
      throw new Error(tGlobal('fsJoinBadExt'));
    }

    const originalFullName = match[1];
    const normPath = firstChunk.path;

    const allChunks = this.state.files
      .filter(
        (f) => f.path === normPath && `${f.name}${f.ext ? '.' + f.ext : ''}`.startsWith(`${originalFullName}.part`),
      )
      .sort((a, b) => {
        const nameA = `${a.name}${a.ext ? '.' + a.ext : ''}`;
        const nameB = `${b.name}${b.ext ? '.' + b.ext : ''}`;
        return nameA.localeCompare(nameB);
      });

    let mergedContent = '';
    let mergedSize = 0;

    allChunks.forEach((chunk) => {
      mergedContent += chunk.content || '';
      mergedSize += chunk.size;
    });

    const normTarget = this.normalizePath(targetPath);
    const joinedFile = this.createFile(targetDriveId, normTarget, originalFullName, mergedContent);
    joinedFile.size = mergedSize;

    this.saveToStorage();
    return joinedFile;
  }

  /**
   * Recursively computes folder sizes (TreeSize style) from the in-memory
   * listing index. The caller must name the drive: the engine has no notion of
   * an "active" drive, and the previous fallback called a method that does not
   * exist, so every invocation without a driveId threw a TypeError.
   *
   * Only directories that have been listed contribute bytes; a bucket that was
   * never loaded (or was evicted by the LRU) simply adds nothing until it is
   * fetched again. That is fine for a virtual drive, whose whole tree lives in
   * this index, and useless for a real one: the disk usage view therefore calls
   * `getTreeSize` there and measures the folders on the machine instead.
   */
  /**
   * Measures a real folder tree on disk through the local server. The in-memory
   * index only knows the folders that have been opened, so a tree built from it
   * reports 0 bytes for everything the user has not visited yet.
   *
   * The answer carries why there is no tree when there is none: a virtual drive
   * has no disk to walk, a server that does not answer is a different problem
   * from a folder closed by permissions, and the view says so in each case.
   *
   * The tree arrives as a newline-delimited stream: a whole drive takes minutes
   * to measure, so the server reports its counters and each finished root folder
   * as it goes and sends the finished tree last. Aborting the caller's signal
   * stops the walk on the server, and an abort is re-thrown so the caller can
   * tell "the user stopped it" from "the scan failed".
   */
  public async getTreeSize(driveId: string, path: string, options: TreeSizeOptions = {}): Promise<TreeSizeResult> {
    // Nothing on disk to measure: a virtual drive lives in this engine's index.
    if (!this.isSystemDrive(driveId)) return { status: 'failed', reason: 'refused' };
    const { signal, onProgress } = options;
    const url = `${API_BASE}/api/treesize?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(path)}`;

    let response: Response;
    try {
      // No retry and no client timeout: the walk lasts as long as the disk
      // needs, and the caller cancels it through its own signal.
      response = await fetch(url, { headers: sessionTokenHeader(), signal });
    } catch (e) {
      if (isAbortError(e)) throw e;
      // No answer at all: the server is down, not a folder refusing to be read.
      log.warn('Could not reach the local server to scan folder sizes', path, e);
      return { status: 'failed', reason: 'unreachable' };
    }
    if (!response.ok) return { status: 'failed', reason: treeSizeFailureForStatus(response.status) };
    if (!response.body) return { status: 'failed', reason: 'unreachable' };

    const counters = { entries: 0, files: 0, dirs: 0, bytes: 0, currentPath: path, elapsedMs: 0 };
    let folders: DiskUsageItem[] = [];
    const emit = () => onProgress?.({ ...counters, folders: [...folders] });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tree: DiskUsageScan | null = null;
    let failure: string | null = null;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;

          let message: ScanMessage;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }

          if (message.type === 'progress') {
            counters.entries = message.entries ?? counters.entries;
            counters.files = message.files ?? counters.files;
            counters.dirs = message.dirs ?? counters.dirs;
            counters.bytes = message.bytes ?? counters.bytes;
            counters.currentPath = message.currentPath || counters.currentPath;
            counters.elapsedMs = message.elapsedMs ?? counters.elapsedMs;
            emit();
          } else if (message.type === 'folder' && message.folder) {
            folders = [...folders, message.folder].sort((a, b) => b.sizeBytes - a.sizeBytes);
            emit();
          } else if (message.type === 'done') {
            tree = message.tree ?? null;
          } else if (message.type === 'error') {
            failure = String(message.error || 'scan failed');
          }
        }
      }
    } catch (e) {
      if (isAbortError(e)) throw e;
      log.warn('The folder size scan stopped early', path, e);
      return { status: 'failed', reason: 'unreachable' };
    } finally {
      reader.releaseLock();
    }

    if (failure) {
      log.warn('The folder size scan failed', path, failure);
      return { status: 'failed', reason: 'refused' };
    }
    if (!tree) return { status: 'failed', reason: 'unreachable' };
    return { status: 'ok', tree };
  }

  public getFolderSizes(path: string, driveId: string): DiskUsageItem | null {
    if (!driveId) return null;
    const normPath = this.normalizePath(path);
    const items = this.getFiles(driveId, normPath);
    const trimmed = normPath.replace(/\\+$/, '');
    const folderItem: DiskUsageItem = {
      path: normPath,
      name: trimmed.split('\\').pop() || normPath,
      sizeBytes: 0,
      fileCount: 0,
      subFolders: [],
    };

    const subDirNames = new Set<string>();
    for (const item of items) {
      if (item.isDirectory) {
        subDirNames.add(item.name);
      } else {
        folderItem.fileCount++;
        folderItem.sizeBytes += item.size || 0;
      }
    }

    for (const subName of subDirNames) {
      const subItem = this.getFolderSizes(this.childAbsolutePath(normPath, subName), driveId);
      if (!subItem) continue;
      folderItem.subFolders!.push(subItem);
      folderItem.sizeBytes += subItem.sizeBytes;
      folderItem.fileCount += subItem.fileCount;
    }

    return folderItem;
  }

  // Reset to factory defaults
  public resetToDefaults() {
    this.drives = [...initialDrives];
    this.state.files = [...initialFiles];
    this.saveToStorage();
  }
}

export const fsEngine = new FileSystemEngine();
