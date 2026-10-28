import JSZip from 'jszip';
import { archiveEntryPath, base64ToBytes, bytesToBase64 } from './zipArchive';
import { buildTar, gzip } from './tarArchive';
import {
  UnsupportedArchiveError,
  formatFromExtension,
  formatLabel,
  isServerReadable,
  loadArchiveBackend,
  withFormatExtension,
  type ArchiveBackend,
  type OpenableArchiveFormat,
} from './archiveBackend';
import { API_BASE } from './apiBase';
import { loadServerArchiveBackend } from './serverArchive';
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

// The archive errors live with the format dispatch that raises them; they stay
// re-exported here because this module is the engine's public surface.
export { ArchivePasswordError, UnsupportedArchiveError } from './archiveBackend';
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

const STORAGE_KEY = 'nc_filesystem_v1';
const DRIVES_STORAGE_KEY = 'nc_drives_v1';
const RECYCLE_BIN_STORAGE_KEY = 'nc_recycle_bin_v1';

/** Progress snapshot of a real filesystem job owned by the local server. */
interface RealFsJob {
  id: string;
  op: string;
  status: 'running' | 'paused' | 'waiting' | 'done' | 'done-with-errors' | 'cancelled' | 'error';
  totalBytes: number;
  copiedBytes: number;
  itemsTotal: number;
  itemsDone: number;
  itemsSkipped: number;
  currentFile: string;
  /** Destination parked for a human answer; present only while status is 'waiting'. */
  pendingConflict: {
    source: string;
    destination: string;
    isDirectory?: boolean;
    sourceSize?: number;
    destinationSize?: number;
    sourceModified?: number;
    destinationModified?: number;
    identical?: boolean;
  } | null;
  /** Tail of the files this job touched, newest last. Bounded by the server. */
  recentFiles: FileProgressEntry[];
  speedBps: number;
  etaSeconds: number;
  errors: Array<{ path: string; message: string }>;
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
 * How long an unobservable job is retried before a transfer is declared failed.
 * The defaults hold a transfer for about ten seconds, which rides out a brief
 * hiccup but refuses to call a dead server a success. Exposed so tests can
 * shrink the window instead of waiting ten real seconds.
 */
export const lostJobRetryPolicy = {
  /** Consecutive polls that may fail to observe the job before giving up. */
  maxPolls: 20,
  /** Delay between those polls, in milliseconds. */
  pollDelayMs: 500,
};

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
  private files: FileItem[] = [];
  private recycleBin: RecycleBinItem[] = [];
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
    if (typeof window === 'undefined') {
      this.drives = [...initialDrives];
      this.files = [...initialFiles];
      this.recycleBin = [];
      return;
    }

    try {
      const savedDrives = localStorage.getItem(DRIVES_STORAGE_KEY);
      const savedFiles = localStorage.getItem(STORAGE_KEY);
      const savedTrash = localStorage.getItem(RECYCLE_BIN_STORAGE_KEY);

      if (savedDrives) {
        this.drives = JSON.parse(savedDrives);
      } else {
        // Real drives only: do not seed virtual drives
        this.drives = [];
      }

      if (savedFiles) {
        this.files = JSON.parse(savedFiles);
      } else {
        this.files = [];
      }

      if (savedTrash) {
        this.recycleBin = JSON.parse(savedTrash);
      } else {
        this.recycleBin = [];
      }
    } catch {
      this.drives = [...initialDrives];
      this.files = [...initialFiles];
      this.recycleBin = [];
    }
  }

  /**
   * Serializes only the fields the UI actually needs. `content` (inline text or
   * base64 payloads) is the heavy, non-visible field that used to blow the
   * localStorage quota; a directory listing reloads it from the server, and
   * virtual files rehydrate lazily. Kept explicit so a future field is a
   * deliberate decision rather than an accidental quota regression.
   */
  private filesForStorage(): Array<Omit<FileItem, 'content'>> {
    return this.files.map((f) => ({
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
    try {
      localStorage.setItem(DRIVES_STORAGE_KEY, JSON.stringify(this.drives));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.filesForStorage()));
      localStorage.setItem(RECYCLE_BIN_STORAGE_KEY, JSON.stringify(this.recycleBin));
    } catch (e) {
      // A quota-exceeded write used to fail silently, so the user lost drives,
      // files and trash with no trace. Log it and keep the app running on the
      // in-memory state instead of pretending the save succeeded.
      log.error('[fileSystem] persist to localStorage failed; continuing in memory', e);
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
      const untouched = this.files.filter((f) => !(f.driveId === driveId && this.normalizePath(f.path) === normPath));
      const mapped: FileItem[] = serverItems.map((item: any, index: number) => ({
        id: `sys_${driveId}_${index}_${Date.now()}`,
        name: item.name,
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

      this.files = [...untouched, ...mapped];
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
    const files = [...this.files];
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
   */
  public async loadRealDrivesFromApi(): Promise<boolean> {
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/drives`, { timeoutMs: 10000, retries: 2 });
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
      log.warn('Could not load real drives from API', e);
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
    const mount = this.findArchive(driveId, currentPath);
    if (mount) return mount.items.filter((item) => this.normalizePath(item.path) === this.normalizePath(currentPath));
    if (this.filesIndexVersion !== this.filesVersion) {
      this.filesIndex.clear();
      for (const f of this.files) {
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
    this.files = this.files.filter((f) => !doomed.has(`${f.driveId}|${this.normalizePath(f.path)}`));
  }

  public getFileById(id: string): FileItem | undefined {
    return (
      this.files.find((f) => f.id === id) ||
      [...this.archives.values()].flatMap((m) => m.items).find((f) => f.id === id)
    );
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

  /**
   * Reads a job snapshot. A 404 means the server no longer knows about the job,
   * which the caller decides how to treat. Transport failures deliberately
   * PROPAGATE: swallowing them here is what let a dead server look like a
   * finished transfer, turning a half-written file into a green 100% in the UI.
   */
  private async getServerJob(jobId: string): Promise<RealFsJob | null> {
    const response = await fetchWithRetry(`${API_BASE}/api/fs/job/${encodeURIComponent(jobId)}`, {
      timeoutMs: 10000,
      retries: 1,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Job status request failed with HTTP ${response.status}`);
    return (await response.json()) as RealFsJob;
  }

  /**
   * Follows a server-side job to completion. The caller's pause/cancel intent
   * is mirrored onto the running job, so pausing in the UI actually stops the
   * transfer on disk instead of only freezing the progress bar.
   */
  private async awaitServerJob(
    jobId: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onJob?: (job: RealFsJob) => void,
    onConflict?: (conflict: PendingConflict) => void,
  ): Promise<RealFsJob | null> {
    let lastPaused = false;
    let lastCancelled = false;
    // Tracks the conflict already handed to the UI so one prompt is raised per
    // destination instead of once per poll. Cleared once the prompt is gone.
    let promptedConflict = '';
    // A job that cannot be observed is NOT a finished job. With the server gone
    // we keep asking for a bounded window before giving up, so a brief hiccup
    // does not fail an otherwise healthy transfer, but a real outage is reported
    // instead of silently completing with a truncated destination file.
    let lostPolls = 0;
    for (;;) {
      let job: RealFsJob | null = null;
      let unobservable = false;
      try {
        job = await this.getServerJob(jobId);
      } catch {
        unobservable = true;
      }

      if (unobservable || !job) {
        lostPolls += 1;
        if (lostPolls > lostJobRetryPolicy.maxPolls) {
          throw new Error(
            'Transfer lost: the local file server stopped responding, so the destination may be incomplete.',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, lostJobRetryPolicy.pollDelayMs));
        continue;
      }
      lostPolls = 0;

      onProgress?.(job.copiedBytes, job.totalBytes);
      // Callers that need entry counts (delete has no byte total) read the raw
      // snapshot here instead of the byte-oriented `onProgress` hook.
      onJob?.(job);

      // Raise a collision prompt at most once. Fire and forget on purpose: the
      // poller must never block on a human, and the UI answers through
      // resolveConflict(), which is what releases the parked server job.
      if (job.pendingConflict) {
        const signature = `${job.id}|${job.pendingConflict.source}|${job.pendingConflict.destination}`;
        if (signature !== promptedConflict) {
          promptedConflict = signature;
          onConflict?.({
            jobId: job.id,
            source: job.pendingConflict.source,
            destination: job.pendingConflict.destination,
            name:
              job.pendingConflict.destination.split(/[\\/]/).filter(Boolean).pop() || job.pendingConflict.destination,
            isDirectory: job.pendingConflict.isDirectory,
            sourceSize: job.pendingConflict.sourceSize,
            destinationSize: job.pendingConflict.destinationSize,
            sourceModified: job.pendingConflict.sourceModified,
            destinationModified: job.pendingConflict.destinationModified,
            identical: job.pendingConflict.identical,
          });
        }
      } else {
        promptedConflict = '';
      }

      if (signal) {
        if (signal.cancelled && !lastCancelled) {
          lastCancelled = true;
          await this.callServerFs(`job/${encodeURIComponent(jobId)}/cancel`, {});
        } else if (!signal.cancelled && signal.paused !== lastPaused) {
          lastPaused = signal.paused;
          await this.callServerFs(`job/${encodeURIComponent(jobId)}/${signal.paused ? 'pause' : 'resume'}`, {});
        }
      }

      if (job.status !== 'running' && job.status !== 'paused' && job.status !== 'waiting') return job;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Answers a collision prompt raised by a running job. `applyToAll` promotes the
   * single answer into the policy for the rest of that transfer, so a large copy
   * does not ask once per colliding file.
   */
  public async resolveConflict(jobId: string, action: ConflictResolution, applyToAll: boolean): Promise<void> {
    await this.callServerFs(`job/${encodeURIComponent(jobId)}/resolve`, {
      decision: action,
      applyToAll: !!applyToAll,
    });
  }

  /** Aborts a job outright, used when the user backs out of a collision prompt. */
  public async cancelJob(jobId: string): Promise<void> {
    await this.callServerFs(`job/${encodeURIComponent(jobId)}/cancel`, {});
  }

  /**
   * Changes the speed limit of a job already in flight. The server applies it
   * from the next chunk, so a large transfer can be slowed down while it runs.
   * A value of 0 means unlimited.
   */
  public async setJobThrottle(jobId: string, throttleBps: number): Promise<void> {
    await this.callServerFs(`job/${encodeURIComponent(jobId)}/throttle`, { throttleBps });
  }

  // Fire-and-forget mutation helper: start the server job, wait for it and then
  // re-read the directory from disk. Reloading unconditionally is deliberate —
  // it repairs the optimistic in-memory state after a cancel or a failure.
  private runRealJob(route: string, body: unknown, driveId: string, reloadPath: string): void {
    void (async () => {
      try {
        const started = await this.callServerFs<{ jobId?: string }>(route, body);
        if (started?.jobId) await this.awaitServerJob(started.jobId);
      } catch (error) {
        // A fire-and-forget job has no task to report on, but a lost transfer
        // must not become an unhandled rejection either.
        console.error('[fileSystem] background job failed', error);
      }
      try {
        await this.loadSystemDriveDirectory(driveId, reloadPath);
      } catch (error) {
        console.error('[fileSystem] directory reload failed', error);
      }
    })();
  }

  /**
   * Runs one server-side transfer of absolute source paths and waits for it.
   * This is the shared core of both a live selection transfer and a transfer
   * replayed from a saved copy list, which only has paths to work with.
   */
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
    const started = await this.callServerFs<{ jobId?: string; totalBytes?: number; itemsTotal?: number }>(op, {
      sources,
      // Panels address a drive root as a bare letter ("C:"), which the server's
      // path guard used to reject. Normalizing here keeps the request well formed
      // whatever the caller passed.
      targetDir: this.normalizePath(targetDir),
      overwrite,
      // SuperCopier-style knobs. Omitted when the caller has no preference, so
      // the server keeps its `overwrite`-derived default.
      ...(options
        ? {
            collision: options.collision,
            throttleBps: options.throttleBps,
            ...(options.force ? { force: true } : {}),
          }
        : {}),
    });
    if (!started?.jobId) {
      // `callServerFs` keeps the server's own reason out of band; surface it so
      // the user sees "Unsafe path: ..." instead of an opaque "could not start".
      const reason = this.lastCallError || 'the local file service did not answer';
      throw new Error(`${op === 'move' ? 'Move' : 'Copy'} could not start: ${reason}`);
    }

    // The server already walked the tree to size the job. Report it so a
    // folder selection does not fall back to the 1 MiB floor, which made an
    // untouched copy look finished at 100%.
    onStart?.({
      totalBytes: Number(started.totalBytes) || 0,
      itemsTotal: Number(started.itemsTotal) || 0,
      jobId: String(started.jobId),
    });

    // The per-file rows come from the same snapshot the progress callback reads,
    // so both surfaces stay in lockstep without a second poll.
    const job = await this.awaitServerJob(
      started.jobId,
      onProgress,
      signal,
      onFiles ? (snapshot) => onFiles(snapshot.recentFiles || []) : undefined,
      onConflict,
    );
    if (job && job.status === 'done-with-errors') {
      throw new Error(job.errors[0]?.message || 'Operation failed');
    }
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
    await this.transferPaths(
      op,
      [this.realAbsolutePath(file)],
      targetPath,
      overwrite,
      onProgress,
      signal,
      options,
      onConflict,
      onFiles,
    );

    const sourceDriveId = file.driveId;
    await this.loadSystemDriveDirectory(targetDriveId, targetPath);
    if (op === 'move' && sourceDriveId !== targetDriveId) {
      await this.loadSystemDriveDirectory(sourceDriveId, file.path);
    }

    const normTarget = this.normalizePath(targetPath);
    const wanted = this.realEntryName(file);
    return this.files.find(
      (candidate) =>
        candidate.driveId === targetDriveId &&
        this.normalizePath(candidate.path) === normTarget &&
        this.realEntryName(candidate) === wanted,
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

  public createDirectory(driveId: string, parentPath: string, dirName: string): FileItem {
    if (this.getArchiveSource(driveId, parentPath)) throw new Error(tGlobal('zipReadOnly'));
    const cleanName = dirName.replace(/[\\/:*?"<>|]/g, '').trim();
    if (!cleanName) throw new Error('Invalid directory name');

    const normParent = this.normalizePath(parentPath);
    const existing = this.files.find(
      (f) =>
        f.driveId === driveId &&
        this.normalizePath(f.path) === normParent &&
        f.name.toUpperCase() === cleanName.toUpperCase() &&
        f.isDirectory,
    );
    if (existing) {
      throw new Error(`Directory ${cleanName} already exists`);
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const newItem: FileItem = {
      id: `dir_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: cleanName,
      ext: '',
      fullName: cleanName,
      path: normParent,
      driveId,
      isDirectory: true,
      size: 0,
      modifiedAt: now,
      createdAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
    };

    this.files.push(newItem);

    // Real-drive write-through: the server owns the disk write.
    if (this.isSystemDrive(driveId)) {
      this.runRealJob(
        'mkdir',
        { path: this.absoluteForDrive(driveId, this.childAbsolutePath(parentPath, cleanName)) },
        driveId,
        parentPath,
      );
    }

    this.saveToStorage();
    return newItem;
  }

  public createFile(driveId: string, parentPath: string, fileName: string, content: string = ''): FileItem {
    if (this.getArchiveSource(driveId, parentPath)) throw new Error(tGlobal('zipReadOnly'));
    const cleanName = fileName.trim();
    if (!cleanName) throw new Error('Invalid file name');

    let ext = '';
    let name = cleanName;
    if (!cleanName.startsWith('.')) {
      const parts = cleanName.split('.');
      if (parts.length > 1) {
        ext = parts.pop()!.toUpperCase();
        name = parts.join('.');
      }
    }

    const normParent = this.normalizePath(parentPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const newItem: FileItem = {
      id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      ext,
      fullName: cleanName,
      path: normParent,
      driveId,
      isDirectory: false,
      size: new Blob([content]).size,
      modifiedAt: now,
      createdAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: true },
      content,
    };

    this.files.push(newItem);

    // Real-drive write-through: the server owns the disk write.
    if (this.isSystemDrive(driveId)) {
      this.runRealJob(
        'write',
        { path: this.absoluteForDrive(driveId, this.childAbsolutePath(parentPath, cleanName)), content },
        driveId,
        parentPath,
      );
    }

    this.saveToStorage();
    return newItem;
  }

  public saveFileContent(fileId: string, content: string) {
    if (this.getFileById(fileId)?.archiveRoot) throw new Error(tGlobal('zipReadOnly'));
    const file = this.files.find((f) => f.id === fileId);
    if (!file) throw new Error('File not found');

    file.content = content;
    file.contentEncoding = 'utf8';
    file.size = new Blob([content]).size;
    file.modifiedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    file.attributes.archive = true;

    // Real-drive write-through: the server owns the disk write.
    if (this.isSystemDrive(file.driveId)) {
      void this.callServerFs('write', { path: this.realAbsolutePath(file), content });
    }

    this.saveToStorage();
  }

  public renameItem(fileId: string, newFullName: string) {
    if (this.getFileById(fileId)?.archiveRoot) throw new Error(tGlobal('zipReadOnly'));
    const file = this.files.find((f) => f.id === fileId);
    if (!file) throw new Error('Item not found');

    const clean = newFullName.trim();
    if (!clean) throw new Error('Invalid name');

    // Resolve the real on-disk path before `name`/`ext` are mutated below.
    const realSourcePath = this.isSystemDrive(file.driveId) ? this.realAbsolutePath(file) : '';

    if (file.isDirectory) {
      const oldDirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${this.normalizePath(file.path)}\\${clean}`;

      // Update all descendants
      this.files.forEach((f) => {
        if (f.driveId === file.driveId && f.path.startsWith(oldDirPath)) {
          f.path = f.path.replace(oldDirPath, newDirPath);
        }
      });

      file.name = clean;
      file.ext = '';
    } else {
      let ext = '';
      let name = clean;
      if (!clean.startsWith('.')) {
        const parts = clean.split('.');
        if (parts.length > 1) {
          ext = parts.pop()!.toUpperCase();
          name = parts.join('.');
        }
      }
      file.name = name;
      file.ext = ext;
    }

    // The server's rename takes the current absolute path and the new leaf name,
    // so `fullName` has to follow the rename: it is what `realAbsolutePath`
    // builds every later path from, and a stale one sends a delete to the old name.
    file.fullName = clean;
    file.modifiedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Real-drive write-through: the server owns the disk write.
    if (this.isSystemDrive(file.driveId)) {
      this.runRealJob('rename', { path: realSourcePath, newName: clean }, file.driveId, file.path);
    }

    this.saveToStorage();
  }

  public deleteItem(fileId: string, useRecycleBin: boolean = false) {
    if (this.getFileById(fileId)?.archiveRoot) throw new Error(tGlobal('zipReadOnly'));
    const file = this.files.find((f) => f.id === fileId);
    if (!file) return;

    const isReal = this.isSystemDrive(file.driveId);

    // The app's own recycle bin is a virtual overlay. Real drives use the
    // Windows Recycle Bin (the server performs the trash move), so they must
    // not also be duplicated into the virtual one.
    if (useRecycleBin && !isReal) {
      this.moveToRecycleBin(fileId);
      return;
    }

    if (isReal) {
      this.runRealJob(
        'delete',
        { targets: [this.realAbsolutePath(file)], useTrash: useRecycleBin },
        file.driveId,
        file.path,
      );
    }

    if (file.isDirectory) {
      const dirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      // Remove all children recursively
      this.files = this.files.filter(
        (f) => !(f.driveId === file.driveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))),
      );
    }

    this.files = this.files.filter((f) => f.id !== fileId);

    this.saveToStorage();
  }

  /**
   * Deletes a batch with real, entry-based progress.
   *
   * A delete moves no bytes, so completion is measured in entries: the server
   * reports `itemsDone`/`itemsTotal` for the batch job and this method streams
   * that ratio to the caller. Virtual drives resolve immediately because they
   * only exist in the app's overlay store, and the affected directories are
   * re-read from disk afterwards so a cancel or a partial failure still leaves
   * the panes showing reality.
   */
  public async deleteItems(
    items: FileItem[],
    useRecycleBin: boolean,
    onProgress?: (done: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<void> {
    const real = items.filter((item) => this.isSystemDrive(item.driveId));
    if (items.some((item) => item.archiveRoot)) throw new Error(tGlobal('zipReadOnly'));
    const virtual = items.filter((item) => !this.isSystemDrive(item.driveId));

    for (const item of virtual) {
      this.deleteItem(item.id, useRecycleBin);
    }

    const total = items.length || 1;
    let done = virtual.length;
    if (real.length === 0) {
      onProgress?.(total, total);
      return;
    }
    onProgress?.(done, total);

    const started = await this.callServerFs<{ jobId?: string }>('delete', {
      targets: real.map((item) => this.realAbsolutePath(item)),
      useTrash: useRecycleBin,
    });
    if (!started?.jobId) {
      const reason = this.lastCallError || 'the local file service did not answer';
      throw new Error(`Delete could not start: ${reason}`);
    }

    const job = await this.awaitServerJob(started.jobId, undefined, signal, (snapshot) => {
      onProgress?.(done + (snapshot.itemsDone || 0), total);
      onFiles?.(snapshot.recentFiles || []);
    });
    if (job && job.status === 'done-with-errors') {
      throw new Error(job.errors[0]?.message || 'Delete failed');
    }

    // Mirror the removal in the overlay listing, then re-read from disk.
    for (const item of real) {
      const file = this.files.find((f) => f.id === item.id);
      if (!file) continue;
      if (file.isDirectory) {
        const dirPath = `${this.normalizePath(file.path)}\\${file.name}`;
        this.files = this.files.filter(
          (f) => !(f.driveId === file.driveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))),
        );
      }
      this.files = this.files.filter((f) => f.id !== file.id);
    }
    this.saveToStorage();

    const reloaded = new Set<string>();
    for (const item of real) {
      const key = `${item.driveId}|${this.normalizePath(item.path)}`;
      if (reloaded.has(key)) continue;
      reloaded.add(key);
      await this.loadSystemDriveDirectory(item.driveId, item.path);
    }

    done = total;
    onProgress?.(done, total);
  }

  public moveToRecycleBin(fileId: string): boolean {
    const file = this.files.find((f) => f.id === fileId);
    if (!file) return false;

    const binItem: RecycleBinItem = {
      id: `trash_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      originalId: file.id,
      originalPath: file.path,
      originalDriveId: file.driveId,
      deletedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      item: { ...file },
    };

    this.recycleBin.unshift(binItem);

    // Also add to TR: drive root virtual listing for seamless browsing
    file.driveId = 'drive_trash';
    file.path = 'TR:';

    if (file.isDirectory) {
      const dirPath = `${this.normalizePath(binItem.originalPath)}\\${file.name}`;
      this.files.forEach((f) => {
        if (f.driveId === binItem.originalDriveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))) {
          f.driveId = 'drive_trash';
          f.path = f.path.replace(binItem.originalDriveId, 'drive_trash');
        }
      });
    }

    this.saveToStorage();
    return true;
  }

  public restoreFromRecycleBin(recycleBinItemId: string): boolean {
    const binIndex = this.recycleBin.findIndex((b) => b.id === recycleBinItemId);
    if (binIndex === -1) return false;

    const binItem = this.recycleBin[binIndex];
    const file = this.files.find((f) => f.id === binItem.originalId);

    if (file) {
      file.driveId = binItem.originalDriveId;
      file.path = binItem.originalPath;

      if (file.isDirectory) {
        this.files.forEach((f) => {
          if (f.driveId === 'drive_trash') {
            f.driveId = binItem.originalDriveId;
          }
        });
      }
    } else {
      // Re-create if somehow unlisted
      this.files.push({
        ...binItem.item,
        driveId: binItem.originalDriveId,
        path: binItem.originalPath,
      });
    }

    this.recycleBin.splice(binIndex, 1);
    this.saveToStorage();
    return true;
  }

  public emptyRecycleBin() {
    this.files = this.files.filter((f) => f.driveId !== 'drive_trash');
    this.recycleBin = [];
    this.saveToStorage();
  }

  public getRecycleBinItems(): RecycleBinItem[] {
    return [...this.recycleBin];
  }

  public deletePermanentlyFromRecycleBin(recycleBinItemId: string) {
    const binIndex = this.recycleBin.findIndex((b) => b.id === recycleBinItemId);
    if (binIndex === -1) return;

    const binItem = this.recycleBin[binIndex];
    this.files = this.files.filter((f) => f.id !== binItem.originalId && f.driveId !== 'drive_trash');
    this.recycleBin.splice(binIndex, 1);
    this.saveToStorage();
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
    if (this.getArchiveSource(targetDriveId, targetPath)) throw new Error(tGlobal('zipReadOnly'));
    const file = this.getFileById(fileId);
    if (file?.archiveRoot) {
      const source = this.getArchiveSource(file.driveId, file.path)!;
      await this.extractArchive(source, targetDriveId, targetPath, file.archiveEntry);
      return file;
    }
    if (!file) {
      log.warn('Copy skipped: no catalogue entry for', fileId);
      return undefined;
    }

    // Real drives are written by the local server, never simulated in memory.
    if (this.isSystemDrive(file.driveId) || this.isSystemDrive(targetDriveId)) {
      return this.realCopyOrMove(
        file,
        'copy',
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

    const normTarget = this.normalizePath(targetPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (file.isDirectory) {
      const oldDirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normTarget}\\${file.name}`;

      // Collect children BEFORE pushing new items (fixes race condition)
      const children = this.files.filter(
        (f) => f.driveId === file.driveId && (f.path === oldDirPath || f.path.startsWith(`${oldDirPath}\\`)),
      );

      // Create target directory
      const newDir: FileItem = {
        ...file,
        id: `dir_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        driveId: targetDriveId,
        path: normTarget,
        createdAt: now,
        modifiedAt: now,
      };
      this.files.push(newDir);

      let transferred = 0;
      const total = children.filter((c) => !c.isDirectory).reduce((s, c) => s + (c.size || 0), 0);

      // Copy all children
      for (const child of children) {
        const relativeChildPath = child.path.substring(oldDirPath.length);
        const childTargetPath = `${newDirPath}${relativeChildPath}`;
        const newChild: FileItem = {
          ...child,
          id: `copy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          driveId: targetDriveId,
          path: childTargetPath,
          createdAt: now,
          modifiedAt: now,
        };
        this.files.push(newChild);
        transferred += child.size || 0;
        if (onProgress) onProgress(transferred, total);
      }

      this.saveToStorage();
      return newDir;
    } else {
      // Check existing in target
      const existing = this.files.find(
        (f) =>
          f.driveId === targetDriveId &&
          this.normalizePath(f.path) === normTarget &&
          f.name === file.name &&
          f.ext === file.ext,
      );
      if (existing) {
        if (overwrite) {
          existing.content = file.content;
          existing.size = file.size;
          existing.modifiedAt = now;
          this.saveToStorage();
          if (onProgress) onProgress(file.size || 0, file.size || 0);
          return existing;
        } else {
          // make unique name
          const newName = `${file.name}_Copy`;
          const newFile: FileItem = {
            ...file,
            id: `copy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            driveId: targetDriveId,
            path: normTarget,
            name: newName,
            createdAt: now,
            modifiedAt: now,
          };
          this.files.push(newFile);
          this.saveToStorage();
          if (onProgress) onProgress(file.size || 0, file.size || 0);
          return newFile;
        }
      } else {
        const newFile: FileItem = {
          ...file,
          id: `copy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          driveId: targetDriveId,
          path: normTarget,
          createdAt: now,
          modifiedAt: now,
        };
        this.files.push(newFile);
        this.saveToStorage();
        if (onProgress) onProgress(file.size || 0, file.size || 0);
        return newFile;
      }
    }
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
    if (this.getFileById(fileId)?.archiveRoot || this.getArchiveSource(targetDriveId, targetPath))
      throw new Error(tGlobal('zipReadOnly'));
    const file = this.files.find((f) => f.id === fileId);
    if (!file) {
      log.warn('Move skipped: no catalogue entry for', fileId);
      return false;
    }

    // Real drives are written by the local server, never simulated in memory.
    if (this.isSystemDrive(file.driveId) || this.isSystemDrive(targetDriveId)) {
      await this.realCopyOrMove(
        file,
        'move',
        targetDriveId,
        targetPath,
        true,
        onProgress,
        signal,
        options,
        onConflict,
        onFiles,
      );
      return true;
    }

    const normTarget = this.normalizePath(targetPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (file.isDirectory) {
      const oldDirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normTarget}\\${file.name}`;

      // Collect children BEFORE modifying (fixes race condition)
      const children = this.files.filter(
        (f) => f.driveId === file.driveId && (f.path === oldDirPath || f.path.startsWith(`${oldDirPath}\\`)),
      );

      // Update children
      for (const f of children) {
        const relativeChildPath = f.path.substring(oldDirPath.length);
        f.path = `${newDirPath}${relativeChildPath}`;
        f.driveId = targetDriveId;
      }

      file.path = normTarget;
      file.driveId = targetDriveId;
      file.modifiedAt = now;
    } else {
      file.path = normTarget;
      file.driveId = targetDriveId;
      file.modifiedAt = now;
    }

    this.saveToStorage();
    if (onProgress) onProgress(1, 1);
    return true;
  }

  // Cryptographic Hash Calculator (MD5 approximation + real Web Crypto SHA-1 & SHA-256)
  public async calculateFileHashes(file: FileItem): Promise<{ md5: string; sha1: string; sha256: string }> {
    return calculateFileHashesImpl(file);
  }

  private archives = new Map<string, { source: FileItem; root: string; backend: ArchiveBackend; items: FileItem[] }>();

  private findArchive(driveId: string, path: string) {
    const normalized = this.normalizePath(path).toLowerCase();
    return [...this.archives.values()].find(
      (m) =>
        m.source.driveId === driveId &&
        (normalized === m.root.toLowerCase() || normalized.startsWith(`${m.root.toLowerCase()}\\`)),
    );
  }

  public getArchiveSource(driveId: string, path: string): FileItem | undefined {
    return this.findArchive(driveId, path)?.source;
  }

  /**
   * The backend of an archive that is already mounted, matched by the file it
   * was opened from. An encrypted archive can only be read through the backend
   * that was opened with its password, so extraction must reuse it rather than
   * open the file again without one.
   */
  private mountedArchiveBackend(archiveFile: FileItem): ArchiveBackend | undefined {
    const target = this.realAbsolutePath(archiveFile).toLowerCase();
    return [...this.archives.values()].find(
      (mounted) => mounted.source.driveId === archiveFile.driveId && mounted.root.toLowerCase() === target,
    )?.backend;
  }

  /**
   * Raw bytes of a file. `maxBytes` caps what comes back and is forwarded to the
   * server as well, so a caller that only needs a preview (the viewer and the
   * editor) never drags a huge file into memory; callers that must see every
   * byte, like the checksums, omit it.
   */
  public async readFileBytes(file: FileItem, options?: { maxBytes?: number }): Promise<Uint8Array> {
    const maxBytes = options?.maxBytes;
    const cap = (bytes: Uint8Array): Uint8Array =>
      maxBytes && bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes;

    if (file.archiveRoot && file.archiveEntry) {
      const mount = this.findArchive(file.driveId, file.archiveRoot);
      if (!mount) throw new Error(tGlobal('zipErrEmpty'));
      return cap(await mount.backend.readEntry(file.archiveEntry));
    }
    if (this.isSystemDrive(file.driveId)) {
      const response = await fetchWithRetry(`${API_BASE}/api/fs/read-bytes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.realAbsolutePath(file), maxBytes }),
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

  private async writeBytes(driveId: string, root: string, relative: string, bytes: Uint8Array): Promise<FileItem> {
    if (this.getArchiveSource(driveId, root)) throw new Error(tGlobal('zipReadOnly'));
    const safe = archiveEntryPath(relative);
    // Kept drive-relative for the catalogue entry, which indexes panels by that
    // form; only the request to the server needs the drive letter.
    const target = this.childAbsolutePath(root, safe);
    if (this.isSystemDrive(driveId)) {
      const response = await fetchWithRetry(
        `${API_BASE}/api/fs/write-bytes?path=${encodeURIComponent(this.absoluteForDrive(driveId, target))}&root=${encodeURIComponent(this.absoluteForDrive(driveId, root))}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob([new Uint8Array(bytes)]),
          retries: 0,
          timeoutMs: 120000,
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
    }
    const parent = this.getParentPath(target);
    const fullName = safe.split('\\').pop()!;
    if (
      !this.isSystemDrive(driveId) &&
      this.getFiles(driveId, parent).some((f) => this.realEntryName(f).toLowerCase() === fullName.toLowerCase())
    ) {
      throw new Error(tGlobal('zipErrExists').replace('{name}', fullName));
    }
    const dot = fullName.lastIndexOf('.');
    const now = new Date().toISOString();
    const item: FileItem = {
      id: `bytes_${Date.now()}_${Math.random()}`,
      driveId,
      path: parent,
      fullName,
      name: dot > 0 ? fullName.slice(0, dot) : fullName,
      ext: dot > 0 ? fullName.slice(dot + 1) : '',
      isDirectory: false,
      size: bytes.length,
      createdAt: now,
      modifiedAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: true },
      content: bytesToBase64(bytes),
      contentEncoding: 'base64',
    };
    this.files.push(item);
    this.saveToStorage();
    return item;
  }

  /**
   * Picks the engine that can actually read an archive.
   *
   * ZIP and TAR are parsed in the renderer. RAR, 7-Zip and the bzip2/lzma TARs
   * are read by the local server, which runs libarchive's WASM and already owns
   * the file, so a large archive is never copied into the renderer to be parsed
   * there. An extension can lie, so a file the local engine refuses is offered
   * to the server when its magic bytes name a format the server can read.
   */
  private async openArchiveBackend(source: FileItem, password?: string): Promise<ArchiveBackend> {
    const fileName = this.realEntryName(source);
    const declared = formatFromExtension(fileName);
    // An entry mounted from another archive is not a file on disk: the server
    // has no path to open for it.
    const onDisk = this.isSystemDrive(source.driveId) && !source.archiveRoot;
    if (onDisk && isServerReadable(declared)) {
      return loadServerArchiveBackend(this.realAbsolutePath(source), fileName, declared, password);
    }
    try {
      return await loadArchiveBackend(await this.readFileBytes(source), fileName, password);
    } catch (error) {
      if (onDisk && error instanceof UnsupportedArchiveError && isServerReadable(error.format)) {
        return loadServerArchiveBackend(this.realAbsolutePath(source), fileName, error.format, password);
      }
      if (!onDisk && isServerReadable(declared)) {
        throw new Error(tGlobal('zipServerDrive').replace('{format}', formatLabel(declared)), { cause: error });
      }
      throw error;
    }
  }

  /**
   * Mounts any archive this build can read into a virtual root inside the
   * catalogue. The format dispatch decides what is openable, so a RAR or a 7Z
   * is refused here naming its format, instead of being handed to JSZip and
   * reported as a corrupt file.
   */
  public async openArchive(source: FileItem, password?: string): Promise<string> {
    const backend = await this.openArchiveBackend(source, password);
    const root = this.realAbsolutePath(source);
    const items: FileItem[] = [];
    for (const entry of backend.entries) {
      const relative = archiveEntryPath(entry.name);
      const fullPath = this.childAbsolutePath(root, relative);
      const fullName = relative.split('\\').pop()!;
      const dot = entry.dir ? -1 : fullName.lastIndexOf('.');
      items.push({
        id: `archive_${source.driveId}_${fullPath}`,
        driveId: source.driveId,
        path: this.getParentPath(fullPath),
        name: dot > 0 ? fullName.slice(0, dot) : fullName,
        ext: dot > 0 ? fullName.slice(dot + 1) : '',
        fullName,
        isDirectory: entry.dir,
        size: entry.dir ? 0 : entry.size,
        createdAt: entry.date.toISOString(),
        modifiedAt: entry.date.toISOString(),
        attributes: { readOnly: true, hidden: false, system: false, archive: true },
        archiveRoot: root,
        archiveEntry: entry.name,
      });
    }
    this.archives.set(`${source.driveId}|${root}`, { source, root, backend, items });
    this.saveToStorage();
    return root;
  }

  /**
   * Creates an archive of the requested format from real bytes, including
   * recursively listed disk folders.
   *
   * The tree is collected once and each format serialises it, so ZIP and TAR
   * cannot drift apart; the stored name always carries the extension of the
   * format that was actually written, never a compound one.
   */
  public async createArchive(
    items: FileItem[],
    archiveName: string,
    targetDriveId: string,
    targetPath: string,
    format: OpenableArchiveFormat = 'ZIP',
  ): Promise<FileItem> {
    const collected: { path: string; dir: boolean; bytes?: Uint8Array; mtime?: Date }[] = [];

    const add = async (item: FileItem, prefix = ''): Promise<void> => {
      const relative = `${prefix}${this.realEntryName(item)}`;
      archiveEntryPath(relative);
      if (item.isDirectory) {
        collected.push({ path: relative, dir: true });
        const path = this.realAbsolutePath(item);
        if (this.isSystemDrive(item.driveId) && !item.archiveRoot) {
          const response = await fetchWithRetry(
            `${API_BASE}/api/list?driveId=${encodeURIComponent(item.driveId)}&path=${encodeURIComponent(path)}`,
            { retries: 0, timeoutMs: 20000 },
          );
          if (!response.ok) throw new Error((await response.json()).error);
          const children = (await response.json()) as FileItem[];
          for (const child of children) await add({ ...child, driveId: item.driveId, path }, `${relative}/`);
        } else {
          for (const child of this.getFiles(item.driveId, path)) await add(child, `${relative}/`);
        }
        return;
      }
      collected.push({
        path: relative,
        dir: false,
        bytes: await this.readFileBytes(item),
        mtime: new Date(item.modifiedAt || Date.now()),
      });
    };
    for (const item of items) await add(item);

    const bytes = await this.serializeArchive(collected, format);
    const result = await this.writeBytes(targetDriveId, targetPath, withFormatExtension(archiveName, format), bytes);
    if (this.isSystemDrive(targetDriveId)) await this.loadSystemDriveDirectory(targetDriveId, targetPath);
    return result;
  }

  /** Serialises a collected tree into the bytes of the chosen format. */
  private async serializeArchive(
    entries: { path: string; dir: boolean; bytes?: Uint8Array; mtime?: Date }[],
    format: OpenableArchiveFormat,
  ): Promise<Uint8Array> {
    if (format === 'ZIP') {
      const zip = new JSZip();
      for (const entry of entries) {
        // Directories are registered explicitly so empty folders survive.
        if (entry.dir) zip.folder(entry.path);
        else zip.file(entry.path, entry.bytes ?? new Uint8Array(0));
      }
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    }
    const tar = buildTar(
      entries.map((entry) => ({ name: entry.path, dir: entry.dir, bytes: entry.bytes, mtime: entry.mtime })),
    );
    return format === 'TAR.GZ' ? gzip(tar) : tar;
  }

  public async extractArchive(
    archiveFile: FileItem,
    targetDriveId: string,
    targetPath: string,
    selectedEntry?: string,
  ): Promise<number> {
    if (this.getArchiveSource(targetDriveId, targetPath)) throw new Error(tGlobal('zipReadOnly'));
    const backend = this.mountedArchiveBackend(archiveFile) ?? (await this.openArchiveBackend(archiveFile));
    const wanted = selectedEntry?.replace(/\/+$/, '');
    const entries = backend.entries.filter(
      (entry) => !wanted || entry.name === wanted || entry.name.startsWith(`${wanted}/`),
    );
    const stripPrefix = selectedEntry ? selectedEntry.replace(/\/$/, '').split('/').slice(0, -1).join('/') : '';
    let extractedCount = 0;
    try {
      for (const entry of entries) {
        const relative = archiveEntryPath(stripPrefix ? entry.name.slice(stripPrefix.length + 1) : entry.name);
        const parts = relative.split('\\');
        const directories = entry.dir ? parts : parts.slice(0, -1);
        let parent = this.normalizePath(targetPath);
        for (const dir of directories) {
          if (this.isSystemDrive(targetDriveId)) {
            const result = await this.callServerFs('mkdir', {
              path: this.childAbsolutePath(parent, dir),
              archiveRoot: targetPath,
            });
            if (!result) throw new Error(this.lastCallError);
          } else if (!this.getFiles(targetDriveId, parent).some((f) => f.isDirectory && f.name === dir)) {
            this.createDirectory(targetDriveId, parent, dir);
          }
          parent = this.childAbsolutePath(parent, dir);
        }
        if (!entry.dir) {
          await this.writeBytes(targetDriveId, targetPath, relative, await entry.read());
          extractedCount++;
        }
      }
    } finally {
      if (this.isSystemDrive(targetDriveId)) await this.loadSystemDriveDirectory(targetDriveId, targetPath);
    }
    return extractedCount;
  }

  // Import external real file from browser input
  public async importBrowserFile(file: File, targetDriveId: string, targetPath: string): Promise<FileItem> {
    return this.writeBytes(targetDriveId, targetPath, file.name, new Uint8Array(await file.arrayBuffer()));
  }

  // File Splitter (Splits file into .part001, .part002, etc.)
  public splitFile(fileId: string, chunkSizeBytes: number, targetDriveId: string, targetPath: string): FileItem[] {
    const file = this.files.find((f) => f.id === fileId);
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
    const firstChunk = this.files.find((f) => f.id === firstChunkId);
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

    const allChunks = this.files
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

          let message: any;
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
            folders = [...folders, message.folder as DiskUsageItem].sort((a, b) => b.sizeBytes - a.sizeBytes);
            emit();
          } else if (message.type === 'done') {
            tree = message.tree as DiskUsageScan;
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
    this.files = [...initialFiles];
    this.saveToStorage();
  }
}

export const fsEngine = new FileSystemEngine();
