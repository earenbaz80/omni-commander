import JSZip from 'jszip';
import { archiveEntryPath, base64ToBytes, bytesToBase64, loadArchive } from './zipArchive';
import {
  ConflictResolution,
  Drive,
  DiskUsageItem,
  FileItem,
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
import { fetchWithRetry } from '../utils/fetchWithRetry';

export class ArchivePasswordError extends Error {
  constructor(
    public filename: string,
    public message: string,
    public reason?: 'required' | 'invalid',
  ) {
    super(`Archive error: ${message}`);
    this.name = 'ArchivePasswordError';
  }
}
import { calculateFileHashes as calculateFileHashesImpl } from './fileSystemCrypto';

const STORAGE_KEY = 'nc_filesystem_v1';
const DRIVES_STORAGE_KEY = 'nc_drives_v1';
const RECYCLE_BIN_STORAGE_KEY = 'nc_recycle_bin_v1';

// In the packaged Electron app the renderer is loaded from file://, so relative
// /api/* requests never reach the embedded server. Resolve against the local
// server's absolute URL when running inside Electron; keep relative paths in
// dev/web mode where Vite proxies /api to http://127.0.0.1:3001.
//
// The port is NOT assumed: the embedded server takes the first free port (3001
// is frequently held by unrelated software) and the main process passes the one
// it actually bound through the preload bridge.
const API_BASE = (() => {
  const bridge = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  if (!bridge?.isElectron) return '';
  const port = Number(bridge.apiPort);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 3001}`;
})();

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

  public async loadSystemDriveDirectory(driveId: string, path: string): Promise<void> {
    if (this.getArchiveSource(driveId, path)) return;
    try {
      const response = await fetchWithRetry(
        `${API_BASE}/api/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(path)}`,
        { timeoutMs: 10000, retries: 2 },
      );
      if (!response.ok) return;
      const serverItems = await response.json();
      if (!Array.isArray(serverItems)) return;

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
    } catch (e) {
      log.warn('Could not list system directory', path, e);
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

  private realAbsolutePath(file: FileItem): string {
    const parent = this.normalizePath(file.path);
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
      this.runRealJob('mkdir', { path: this.childAbsolutePath(parentPath, cleanName) }, driveId, parentPath);
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
      this.runRealJob('write', { path: this.childAbsolutePath(parentPath, cleanName), content }, driveId, parentPath);
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
      await this.extractZipArchive(source, targetDriveId, targetPath, file.archiveEntry);
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

  private archives = new Map<string, { source: FileItem; root: string; zip: JSZip; items: FileItem[] }>();

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

  public async readFileBytes(file: FileItem): Promise<Uint8Array> {
    if (file.archiveRoot && file.archiveEntry) {
      const mount = this.findArchive(file.driveId, file.archiveRoot);
      const entry = mount?.zip.file(file.archiveEntry);
      if (!entry) throw new Error(tGlobal('zipErrEmpty'));
      return entry.async('uint8array');
    }
    if (this.isSystemDrive(file.driveId)) {
      const response = await fetchWithRetry(`${API_BASE}/api/fs/read-bytes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.realAbsolutePath(file) }),
        retries: 0,
        timeoutMs: 120000,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      return new Uint8Array(await response.arrayBuffer());
    }
    if (file.contentEncoding === 'base64' || file.ext.toUpperCase() === 'ZIP') return base64ToBytes(file.content || '');
    return new TextEncoder().encode(file.content || '');
  }

  private async writeBytes(driveId: string, root: string, relative: string, bytes: Uint8Array): Promise<FileItem> {
    if (this.getArchiveSource(driveId, root)) throw new Error(tGlobal('zipReadOnly'));
    const safe = archiveEntryPath(relative);
    const target = this.childAbsolutePath(root, safe);
    if (this.isSystemDrive(driveId)) {
      const response = await fetchWithRetry(
        `${API_BASE}/api/fs/write-bytes?path=${encodeURIComponent(target)}&root=${encodeURIComponent(root)}`,
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

  public async openZipArchive(source: FileItem, password?: string): Promise<string> {
    const zip = await loadArchive(await this.readFileBytes(source), this.realEntryName(source), password);
    const root = this.realAbsolutePath(source);
    const items: FileItem[] = [];
    for (const entry of Object.values(zip.files)) {
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
        size: entry.dir ? 0 : (await entry.async('uint8array')).length,
        createdAt: entry.date.toISOString(),
        modifiedAt: entry.date.toISOString(),
        attributes: { readOnly: true, hidden: false, system: false, archive: true },
        archiveRoot: root,
        archiveEntry: entry.name,
      });
    }
    this.archives.set(`${source.driveId}|${root}`, { source, root, zip, items });
    this.saveToStorage();
    return root;
  }

  // Create a ZIP from actual bytes, including recursively listed disk folders.
  public async createZipArchive(
    items: FileItem[],
    archiveName: string,
    targetDriveId: string,
    targetPath: string,
  ): Promise<FileItem> {
    const zip = new JSZip();

    const add = async (item: FileItem, prefix = ''): Promise<void> => {
      const relative = `${prefix}${this.realEntryName(item)}`;
      archiveEntryPath(relative);
      if (item.isDirectory) {
        zip.folder(relative);
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
      } else zip.file(relative, await this.readFileBytes(item));
    };
    for (const item of items) await add(item);
    let cleanArchive = archiveName.trim();
    if (!cleanArchive.toUpperCase().endsWith('.ZIP')) {
      cleanArchive += '.ZIP';
    }

    const result = await this.writeBytes(
      targetDriveId,
      targetPath,
      cleanArchive,
      await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    );
    if (this.isSystemDrive(targetDriveId)) await this.loadSystemDriveDirectory(targetDriveId, targetPath);
    return result;
  }

  public async extractZipArchive(
    zipFile: FileItem,
    targetDriveId: string,
    targetPath: string,
    selectedEntry?: string,
  ): Promise<number> {
    if (this.getArchiveSource(targetDriveId, targetPath)) throw new Error(tGlobal('zipReadOnly'));
    const loaded = await loadArchive(await this.readFileBytes(zipFile), this.realEntryName(zipFile));
    const entries = Object.values(loaded.files).filter(
      (entry) =>
        !selectedEntry ||
        entry.name === selectedEntry ||
        (selectedEntry.endsWith('/') && entry.name.startsWith(selectedEntry)),
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
          await this.writeBytes(targetDriveId, targetPath, relative, await entry.async('uint8array'));
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

  // Recursively compute folder sizes (TreeSize style)
  public getFolderSizes(path: string, driveId?: string): DiskUsageItem | null {
    const normPath = this.normalizePath(path);
    const items = this.getFiles(driveId || this.getActiveDriveId() || 'C');
    const rootFiles = items.filter((i) => i.path === normPath || i.path === normPath + '\\');
    const folderItem: DiskUsageItem = {
      path: normPath,
      name: normPath.split('\\').pop() || normPath,
      sizeBytes: 0,
      fileCount: 0,
      subFolders: [],
    };
    const subDirNames = new Set<string>();
    rootFiles.forEach((f) => {
      const parentDir = f.path;
      const fullPath = parentDir ? parentDir + '\\' + f.name : f.name;
      if (f.isDirectory) {
        subDirNames.add(f.name);
      } else {
        folderItem.fileCount++;
        folderItem.sizeBytes += f.size || 0;
      }
    });
    Array.from(subDirNames).forEach((subName) => {
      const subPath = normPath ? normPath + '\\' + subName : subName;
      const subItem = this.getFolderSizes(subPath, driveId || this.getActiveDriveId() || 'C');
      if (subItem) {
        folderItem.subFolders!.push(subItem);
        folderItem.sizeBytes += subItem.sizeBytes;
        folderItem.fileCount += subItem.fileCount;
      }
    });
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
