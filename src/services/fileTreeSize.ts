import type {
  DiskUsageItem,
  DiskUsageScan,
  FileItem,
  TreeSizeFailure,
  TreeSizeOptions,
  TreeSizeResult,
} from '../types';
import { API_BASE } from './apiBase';
import { sessionTokenHeader } from '../utils/fetchWithRetry';
import { log } from '../utils/logger';

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
 * What measuring a folder needs from the catalogue.
 *
 * The scan itself runs on the server and streams back; the two things this module
 * contributes are the request that starts it and the local fallback that answers
 * from what the catalogue already listed — which is why a folder size can appear
 * instantly for a virtual drive and has to be asked for on a real one.
 */
export interface TreeSizeDeps {
  getFiles: (driveId: string, currentPath: string) => FileItem[];
  childAbsolutePath: (parentPath: string, childName: string) => string;
  isSystemDrive: (driveId: string) => boolean;
  normalizePath: (path: string) => string;
}

/**
 * Folder sizes: the measured scan for real drives and the listed arithmetic for
 * everything else. A cancelled request is rethrown untouched, because a cancel
 * is not a scan that failed and the panel tells them apart.
 */
export function createTreeSizeOps(deps: TreeSizeDeps) {
  const { getFiles, childAbsolutePath, isSystemDrive, normalizePath } = deps;

  async function getTreeSize(driveId: string, path: string, options: TreeSizeOptions = {}): Promise<TreeSizeResult> {
    // Nothing on disk to measure: a virtual drive lives in this engine's index.
    if (!isSystemDrive(driveId)) return { status: 'failed', reason: 'refused' };
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

  function getFolderSizes(path: string, driveId: string): DiskUsageItem | null {
    if (!driveId) return null;
    const normPath = normalizePath(path);
    const items = getFiles(driveId, normPath);
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
      const subItem = getFolderSizes(childAbsolutePath(normPath, subName), driveId);
      if (!subItem) continue;
      folderItem.subFolders!.push(subItem);
      folderItem.sizeBytes += subItem.sizeBytes;
      folderItem.fileCount += subItem.fileCount;
    }

    return folderItem;
  }

  // Reset to factory defaults

  return { getTreeSize, getFolderSizes };
}
