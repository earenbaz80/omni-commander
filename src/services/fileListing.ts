import type { Drive, FileItem } from '../types';
import type { EngineState } from './fileEngineState';
import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { log } from '../utils/logger';

/**
 * What reading the catalogue needs: the state itself, the cache bound, and the
 * three things it cannot recompute — the archive overlay, a save, and the entry a
 * mounted archive already holds.
 */
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

export interface ListingDeps {
  state: EngineState;
  /** Maximum directory buckets kept in memory; a test shrinks it. */
  cachePolicy: { maxCachedDirectories: number };
  getArchiveSource: (driveId: string, path: string) => FileItem | undefined;
  saveToStorage: () => void;
  findMountedItem: (id: string) => FileItem | undefined;
  /** A mounted archive covers a path; only its entries are read here. */
  findArchive: (driveId: string, path: string) => { items: FileItem[] } | undefined;
}

/**
 * Drives, directory listings and the path arithmetic that turns a panel path into
 * an absolute one.
 *
 * The listing cache is bounded on purpose: every directory ever visited used to
 * accumulate forever and the whole array is persisted, so a long session blew the
 * storage quota. It now keeps at most `maxCachedDirectories` buckets, dropping the
 * least recently used, and a directory the user returns to simply reloads.
 */
export function createListingOps(deps: ListingDeps) {
  const {
    state,
    cachePolicy: listingCachePolicy,
    getArchiveSource,
    saveToStorage,
    findMountedItem,
    findArchive,
  } = deps;

  function getDrives(): Drive[] {
    return [...state.drives];
  }

  /**
   * Reads one directory from disk into the catalogue. Resolves `true` when the
   * server listed it, `false` when it refused or could not be reached: callers
   * that offer the folder as a destination need to tell "empty" from "gone".
   */
  async function loadSystemDriveDirectory(driveId: string, path: string): Promise<boolean> {
    if (getArchiveSource(driveId, path)) return false;
    try {
      const response = await fetchWithRetry(
        `${API_BASE}/api/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(path)}`,
        { timeoutMs: 10000, retries: 2 },
      );
      if (!response.ok) return false;
      const serverItems = await response.json();
      if (!Array.isArray(serverItems)) return false;

      const normPath = normalizePath(path);
      const untouched = state.files.filter((f) => !(f.driveId === driveId && normalizePath(f.path) === normPath));
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

      state.files = [...untouched, ...mapped];
      touchBucket(driveId, normPath);
      saveToStorage();
      return true;
    } catch (e) {
      log.warn('Could not list system directory', path, e);
      return false;
    }
  }

  function getSearchIndex(searchAllDrives: boolean = false, currentDriveId: string = ''): FileItem[] {
    // Centralized indexed access instead of reaching private internals.
    const files = [...state.files];
    if (searchAllDrives) return files;
    return files.filter((file) => file.driveId === currentDriveId);
  }

  function setDrives(next: Drive[]) {
    state.drives = Array.isArray(next) ? next : [];
    saveToStorage();
  }

  /**
   * Stable field signature used to detect real drive-list changes across
   * polls: an unchanged machine must cost one fetch and nothing else.
   */
  function driveSignature(drive: Drive): string {
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
  async function loadRealDrivesFromApi(options: { signal?: AbortSignal } = {}): Promise<boolean> {
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
        next.length !== state.drives.length ||
        next.some((d, i) => driveSignature(d) !== driveSignature(state.drives[i]));
      if (changed) {
        setDrives(next);
      }
      return true;
    } catch (e) {
      if (!options.signal?.aborted) log.warn('Could not load real drives from API', e);
      return false;
    }
  }

  function getDrive(driveId: string): Drive | undefined {
    return state.drives.find((d) => d.id === driveId);
  }

  function getDriveByLetter(letter: string): Drive | undefined {
    const formatted = letter.endsWith(':') ? letter : `${letter}:`;
    return state.drives.find((d) => d.letter.toUpperCase() === formatted.toUpperCase());
  }

  function getFiles(driveId: string, currentPath: string): FileItem[] {
    const mount = findArchive(driveId, currentPath);
    if (mount) return mount.items.filter((item) => normalizePath(item.path) === normalizePath(currentPath));
    if (state.filesIndexVersion !== state.filesVersion) {
      state.filesIndex.clear();
      for (const f of state.files) {
        const key = `${f.driveId}|${normalizePath(f.path)}`;
        const bucket = state.filesIndex.get(key);
        if (bucket) bucket.push(f);
        else state.filesIndex.set(key, [f]);
      }
      state.filesIndexVersion = state.filesVersion;
    }
    const key = `${driveId}|${normalizePath(currentPath)}`;
    // Reading a bucket marks it as recently used, so the LRU evicts what the
    // user has actually stopped looking at.
    if (state.bucketOrder.has(key)) {
      state.bucketOrder.delete(key);
      state.bucketOrder.set(key, true);
    }
    return state.filesIndex.get(key) || [];
  }

  /** Trash and other virtual entries live only in memory, so the LRU never drops them. */
  function bucketEvictable(key: string): boolean {
    return key.startsWith('real_');
  }

  /**
   * Records a directory bucket as recently used and evicts the least-recently-used
   * real-drive buckets past the cap. Virtual/trash buckets are exempt: they have no
   * server-side listing to reload from.
   */
  function touchBucket(driveId: string, path: string) {
    const key = `${driveId}|${normalizePath(path)}`;
    state.bucketOrder.delete(key);
    state.bucketOrder.set(key, true);

    const evictable = [...state.bucketOrder.keys()].filter((k) => bucketEvictable(k));
    if (evictable.length <= listingCachePolicy.maxCachedDirectories) return;

    const overBy = evictable.length - listingCachePolicy.maxCachedDirectories;
    const doomed = new Set(evictable.slice(0, overBy));
    if (doomed.size === 0) return;

    state.bucketOrder = new Map([...state.bucketOrder].filter(([k]) => !doomed.has(k)));
    state.files = state.files.filter((f) => !doomed.has(`${f.driveId}|${normalizePath(f.path)}`));
  }

  function getFileById(id: string): FileItem | undefined {
    return state.files.find((f) => f.id === id) || findMountedItem(id);
  }

  function normalizePath(path: string): string {
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

  function getParentPath(path: string): string {
    const norm = normalizePath(path);
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

  function isSystemDrive(driveId: string): boolean {
    return !!driveId && driveId.startsWith('real_');
  }

  // Display splits `name`/`ext`; the on-disk name is what actually has to be
  // addressed, and for directories it is always the untouched original.
  function realEntryName(file: FileItem): string {
    if (file.fullName) return file.fullName;
    if (file.isDirectory) return file.name;
    return file.ext ? `${file.name}.${file.ext}` : file.name;
  }

  /**
   * Drive letter a real-drive id stands for: `real_C` -> `C:`. Panels hold their
   * location relative to the drive ("Users\\name"), but the server accepts only
   * drive-letter absolute paths, so the letter has to be put back before a call.
   */
  function driveLetterOf(driveId: string): string {
    const match = /^real_([A-Za-z])$/.exec(driveId);
    return match ? `${match[1].toUpperCase()}:` : '';
  }

  /** Absolute on-disk form of a real-drive path, which the panels keep relative. */
  function absoluteForDrive(driveId: string, targetPath: string): string {
    const normalized = normalizePath(targetPath);
    if (/^[A-Za-z]:/.test(normalized)) return normalized;
    const letter = driveLetterOf(driveId);
    if (!letter) return normalized;
    return normalizePath(normalized ? `${letter}\\${normalized}` : letter);
  }

  function realAbsolutePath(file: FileItem): string {
    const parent = absoluteForDrive(file.driveId, file.path);
    const trimmed = parent.endsWith('\\') ? parent.slice(0, -1) : parent;
    return `${trimmed}\\${realEntryName(file)}`;
  }

  function childAbsolutePath(parentPath: string, childName: string): string {
    const parent = normalizePath(parentPath);
    const trimmed = parent.endsWith('\\') ? parent.slice(0, -1) : parent;
    return `${trimmed}\\${childName}`;
  }

  return {
    getDrives,
    loadSystemDriveDirectory,
    getSearchIndex,
    setDrives,
    driveSignature,
    loadRealDrivesFromApi,
    getDrive,
    getDriveByLetter,
    getFiles,
    bucketEvictable,
    touchBucket,
    getFileById,
    normalizePath,
    getParentPath,
    isSystemDrive,
    realEntryName,
    driveLetterOf,
    absoluteForDrive,
    realAbsolutePath,
    childAbsolutePath,
  };
}
