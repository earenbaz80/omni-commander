import { base64ToBytes } from './zipArchive';
import type { OpenableArchiveFormat } from './archiveBackend';
import { API_BASE } from './apiBase';
import { createArchiveOps, type ArchiveOps, type ExtractHooks } from './fileArchiveOps';
import { createCatalogOps } from './fileCatalog';
import type { EngineState } from './fileEngineState';
import { createStorageOps } from './fileStorageOps';
import { createListingOps } from './fileListing';
import { createCopyMoveOps } from './fileCopyMove';
import { createFolderQueries } from './fileFolderQueries';
import { createTreeSizeOps } from './fileTreeSize';
import { createTransferOps, type RealFsJob, type TransferOps } from './fileTransfer';
import type { OpenWithProgram } from './openWith';
import {
  ConflictResolution,
  Drive,
  DiskUsageItem,
  FileItem,
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
import { fetchWithRetry } from '../utils/fetchWithRetry';

// The archive errors live with the format dispatch that raises them; they stay
// re-exported here because this module is the engine's public surface.
export { ArchivePasswordError, UnsupportedArchiveError } from './archiveBackend';
// The transfer policy lives with the poller now; tests still import it from here.
export { lostJobRetryPolicy } from './fileTransfer';
export type { ArchiveBackend, OpenableArchiveFormat } from './archiveBackend';
// The cleanup surface belongs to the folder-query module now; it stays
// re-exported here because this module is the engine's public surface.
import type { CleanupRun, CleanupScan, CleanupTarget, CleanupTargetId, SendToDestination } from './fileFolderQueries';
export type { CleanupRun, CleanupScan, CleanupTarget, CleanupTargetId, SendToDestination };
export { cleanupTargets } from './fileFolderQueries';

import { calculateFileHashes as calculateFileHashesImpl } from './fileSystemCrypto';

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
  /**
   * Everything the engine keeps in memory: drives, catalogue, trash, subscribers
   * and the listing cache. One holder, because the extracted operations reassign
   * whole lists and bump counters that other layers read.
   */
  private state: EngineState = {
    drives: [],
    files: [],
    recycleBin: [],
    listeners: [],
    storageSaveTimer: null,
    filesVersion: 0,
    filesIndexVersion: -1,
    filesIndex: new Map(),
    bucketOrder: new Map(),
  };

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushStorage());
    }
  }

  /** Persistence and subscribers, built on first use. */
  private storageOps: ReturnType<typeof createStorageOps> | null = null;

  private get storage(): ReturnType<typeof createStorageOps> {
    this.storageOps ??= createStorageOps({ state: this.state });
    return this.storageOps;
  }

  private loadFromStorage() {
    this.storage.loadFromStorage();
  }

  public flushStorage() {
    this.storage.flushStorage();
  }

  public saveToStorage() {
    this.storage.saveToStorage();
  }

  public subscribe(listener: () => void) {
    return this.storage.subscribe(listener);
  }

  /** Drives, listings and the real-drive path bridge, built on first use. */
  private listingInstance: ReturnType<typeof createListingOps> | null = null;

  private get listing(): ReturnType<typeof createListingOps> {
    this.listingInstance ??= createListingOps({
      state: this.state,
      cachePolicy: listingCachePolicy,
      getArchiveSource: (driveId, path) => this.getArchiveSource(driveId, path),
      saveToStorage: () => this.saveToStorage(),
      findMountedItem: (id) => this.archiveOps.findMountedItem(id),
      findArchive: (driveId, path) => this.archiveOps.findArchive(driveId, path),
    });
    return this.listingInstance;
  }

  public getDrives = (): Drive[] => this.listing.getDrives();
  public loadSystemDriveDirectory = (driveId: string, path: string): Promise<boolean> =>
    this.listing.loadSystemDriveDirectory(driveId, path);
  public getSearchIndex = (searchAllDrives: boolean = false, currentDriveId: string = ''): FileItem[] =>
    this.listing.getSearchIndex(searchAllDrives, currentDriveId);
  public setDrives = (next: Drive[]): void => this.listing.setDrives(next);
  public loadRealDrivesFromApi = (options: { signal?: AbortSignal } = {}): Promise<boolean> =>
    this.listing.loadRealDrivesFromApi(options);
  public getDrive = (driveId: string): Drive | undefined => this.listing.getDrive(driveId);
  public getDriveByLetter = (letter: string): Drive | undefined => this.listing.getDriveByLetter(letter);
  public getFiles = (driveId: string, currentPath: string): FileItem[] => this.listing.getFiles(driveId, currentPath);
  public getFileById = (id: string): FileItem | undefined => this.listing.getFileById(id);
  public normalizePath = (path: string): string => this.listing.normalizePath(path);
  public getParentPath = (path: string): string => this.listing.getParentPath(path);
  public isSystemDrive = (driveId: string): boolean => this.listing.isSystemDrive(driveId);
  private realAbsolutePath = (file: FileItem): string => this.listing.realAbsolutePath(file);
  public childAbsolutePath = (parentPath: string, childName: string): string =>
    this.listing.childAbsolutePath(parentPath, childName);
  public absoluteForDrive = (driveId: string, targetPath: string): string =>
    this.listing.absoluteForDrive(driveId, targetPath);
  private realEntryName = (file: FileItem): string => this.listing.realEntryName(file);
  public driveSignature = (drive: Drive): string => this.listing.driveSignature(drive);
  public bucketEvictable = (key: string): boolean => this.listing.bucketEvictable(key);
  public touchBucket = (driveId: string, path: string): void => this.listing.touchBucket(driveId, path);

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
  /** Send-To, existence checks and temp cleanup, built on first use. */
  private folderQueriesInstance: ReturnType<typeof createFolderQueries> | null = null;

  private get folderQueries(): ReturnType<typeof createFolderQueries> {
    this.folderQueriesInstance ??= createFolderQueries({
      absoluteForDrive: (driveId, targetPath) => this.absoluteForDrive(driveId, targetPath),
      realAbsolutePath: (file) => this.realAbsolutePath(file),
      callServerFs: (route, body) => this.callServerFs(route, body),
      lastCallError: () => this.lastCallError,
    });
    return this.folderQueriesInstance;
  }

  /**
   * Which of these absolute folders still exist. Resolves null when the server
   * could not answer at all, and leaves the paths it refused to judge out of
   * `missing`: a caller must never prune a favourite over a failed request.
   */
  public async missingFolders(paths: string[]): Promise<string[] | null> {
    return this.folderQueries.missingFolders(paths);
  }

  get lastServerError(): string {
    return this.folderQueries.lastServerError();
  }

  async sendTo(destination: SendToDestination, item: FileItem): Promise<string | null> {
    return this.folderQueries.sendTo(destination, item);
  }

  /** Same, into a folder the user picked in the dialog (a copy). */
  async sendToFolder(driveId: string, folderPath: string, item: FileItem): Promise<string | null> {
    return this.folderQueries.sendToFolder(driveId, folderPath, item);
  }

  /** The folders the cleanup menu may offer, with the paths the server owns. */
  async listCleanupTargets(): Promise<CleanupTarget[] | null> {
    return this.folderQueries.listCleanupTargets();
  }

  /** Measures what emptying one cleanup folder would free, changing nothing. */
  async scanCleanup(target: CleanupTargetId, minAgeDays: number): Promise<CleanupScan | null> {
    return this.folderQueries.scanCleanup(target, minAgeDays);
  }

  async runCleanup(target: CleanupTargetId, minAgeDays: number): Promise<CleanupRun | null> {
    return this.folderQueries.runCleanup(target, minAgeDays);
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
    hooks?: ExtractHooks,
  ): Promise<number> {
    return this.archiveOps.extractArchive(archiveFile, targetDriveId, targetPath, selectedEntry, hooks);
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
  /** Folder sizes, built on first use: the server scan and the listed fallback. */
  private treeSizeOpsInstance: ReturnType<typeof createTreeSizeOps> | null = null;

  private get treeSizeOps(): ReturnType<typeof createTreeSizeOps> {
    this.treeSizeOpsInstance ??= createTreeSizeOps({
      getFiles: (driveId, currentPath) => this.getFiles(driveId, currentPath),
      childAbsolutePath: (parentPath, childName) => this.childAbsolutePath(parentPath, childName),
      isSystemDrive: (driveId) => this.isSystemDrive(driveId),
      normalizePath: (path) => this.normalizePath(path),
    });
    return this.treeSizeOpsInstance;
  }

  public async getTreeSize(driveId: string, path: string, options: TreeSizeOptions = {}): Promise<TreeSizeResult> {
    return this.treeSizeOps.getTreeSize(driveId, path, options);
  }

  public getFolderSizes(path: string, driveId: string): DiskUsageItem | null {
    return this.treeSizeOps.getFolderSizes(path, driveId);
  }

  public resetToDefaults() {
    this.state.drives = [...initialDrives];
    this.state.files = [...initialFiles];
    this.saveToStorage();
  }
}

export const fsEngine = new FileSystemEngine();
