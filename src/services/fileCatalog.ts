import type { FileProgressEntry, FileItem, RecycleBinItem } from '../types';
import type { RealFsJob } from './fileTransfer';
import { tGlobal } from '../i18n/translations';

/**
 * The catalogue the app writes into, and the trash that parks what it deletes.
 *
 * One holder, not two fields: these operations reassign the whole list (dropping
 * a folder's descendants, emptying the trash), so a copy taken at the start of a
 * call would silently write into an array nothing reads any more.
 */
export interface CatalogueState {
  files: FileItem[];
  recycleBin: RecycleBinItem[];
}

/**
 * What the catalogue operations need from the engine, named one by one.
 *
 * These eleven methods used to sit in the middle of an 1 800-line class reaching
 * into a dozen of its members: the path arithmetic, the archive overlay, the
 * server bridge and the re-list that follows a real-drive write. What they
 * actually need is this list, and a signature is where that stays true.
 */
export interface CatalogueOpsDeps {
  state: CatalogueState;
  normalizePath: (path: string) => string;
  isSystemDrive: (driveId: string) => boolean;
  absoluteForDrive: (driveId: string, targetPath: string) => string;
  childAbsolutePath: (parentPath: string, childName: string) => string;
  realAbsolutePath: (file: FileItem) => string;
  getArchiveSource: (driveId: string, path: string) => FileItem | undefined;
  getFileById: (id: string) => FileItem | undefined;
  runRealJob: (route: string, body: unknown, driveId: string, reloadPath: string) => void;
  callServerFs: <T>(route: string, body: unknown) => Promise<T | null>;
  awaitServerJob: (
    jobId: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onJob?: (job: RealFsJob) => void,
  ) => Promise<RealFsJob | null>;
  lastCallError: () => string;
  saveToStorage: () => void;
  loadSystemDriveDirectory: (driveId: string, path: string) => Promise<boolean>;
}

/**
 * Creating, renaming, deleting and trashing catalogue entries.
 *
 * Both rules that keep this honest are about the overlay: a real drive is written
 * by the server and mirrored here afterwards, and the app's own trash is virtual,
 * so it must never park an entry the Windows Recycle Bin already took.
 */
export function createCatalogOps(deps: CatalogueOpsDeps) {
  const {
    state,
    normalizePath,
    isSystemDrive,
    absoluteForDrive,
    childAbsolutePath,
    realAbsolutePath,
    getArchiveSource,
    getFileById,
    runRealJob,
    callServerFs,
    awaitServerJob,
    lastCallError,
    saveToStorage,
    loadSystemDriveDirectory,
  } = deps;

  function createDirectory(driveId: string, parentPath: string, dirName: string): FileItem {
    if (getArchiveSource(driveId, parentPath)) throw new Error(tGlobal('zipReadOnly'));
    const cleanName = dirName.replace(/[\\/:*?"<>|]/g, '').trim();
    if (!cleanName) throw new Error('Invalid directory name');

    const normParent = normalizePath(parentPath);
    const existing = state.files.find(
      (f) =>
        f.driveId === driveId &&
        normalizePath(f.path) === normParent &&
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

    state.files.push(newItem);

    // Real-drive write-through: the server owns the disk write.
    if (isSystemDrive(driveId)) {
      runRealJob(
        'mkdir',
        { path: absoluteForDrive(driveId, childAbsolutePath(parentPath, cleanName)) },
        driveId,
        parentPath,
      );
    }

    saveToStorage();
    return newItem;
  }

  function createFile(driveId: string, parentPath: string, fileName: string, content: string = ''): FileItem {
    if (getArchiveSource(driveId, parentPath)) throw new Error(tGlobal('zipReadOnly'));
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

    const normParent = normalizePath(parentPath);
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

    state.files.push(newItem);

    // Real-drive write-through: the server owns the disk write.
    if (isSystemDrive(driveId)) {
      runRealJob(
        'write',
        { path: absoluteForDrive(driveId, childAbsolutePath(parentPath, cleanName)), content },
        driveId,
        parentPath,
      );
    }

    saveToStorage();
    return newItem;
  }

  function saveFileContent(fileId: string, content: string) {
    if (getFileById(fileId)?.archiveRoot) throw new Error(tGlobal('zipReadOnly'));
    const file = state.files.find((f) => f.id === fileId);
    if (!file) throw new Error('File not found');

    file.content = content;
    file.contentEncoding = 'utf8';
    file.size = new Blob([content]).size;
    file.modifiedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    file.attributes.archive = true;

    // Real-drive write-through: the server owns the disk write.
    if (isSystemDrive(file.driveId)) {
      void callServerFs('write', { path: realAbsolutePath(file), content });
    }

    saveToStorage();
  }

  function renameItem(fileId: string, newFullName: string) {
    if (getFileById(fileId)?.archiveRoot) throw new Error(tGlobal('zipReadOnly'));
    const file = state.files.find((f) => f.id === fileId);
    if (!file) throw new Error('Item not found');

    const clean = newFullName.trim();
    if (!clean) throw new Error('Invalid name');

    // Resolve the real on-disk path before `name`/`ext` are mutated below.
    const realSourcePath = isSystemDrive(file.driveId) ? realAbsolutePath(file) : '';

    if (file.isDirectory) {
      const oldDirPath = `${normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normalizePath(file.path)}\\${clean}`;

      // Update all descendants
      state.files.forEach((f) => {
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
    if (isSystemDrive(file.driveId)) {
      runRealJob('rename', { path: realSourcePath, newName: clean }, file.driveId, file.path);
    }

    saveToStorage();
  }

  function deleteItem(fileId: string, useRecycleBin: boolean = false) {
    if (getFileById(fileId)?.archiveRoot) throw new Error(tGlobal('zipReadOnly'));
    const file = state.files.find((f) => f.id === fileId);
    if (!file) return;

    const isReal = isSystemDrive(file.driveId);

    // The app's own recycle bin is a virtual overlay. Real drives use the
    // Windows Recycle Bin (the server performs the trash move), so they must
    // not also be duplicated into the virtual one.
    if (useRecycleBin && !isReal) {
      moveToRecycleBin(fileId);
      return;
    }

    if (isReal) {
      runRealJob('delete', { targets: [realAbsolutePath(file)], useTrash: useRecycleBin }, file.driveId, file.path);
    }

    if (file.isDirectory) {
      const dirPath = `${normalizePath(file.path)}\\${file.name}`;
      // Remove all children recursively
      state.files = state.files.filter(
        (f) => !(f.driveId === file.driveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))),
      );
    }

    state.files = state.files.filter((f) => f.id !== fileId);

    saveToStorage();
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
  async function deleteItems(
    items: FileItem[],
    useRecycleBin: boolean,
    onProgress?: (done: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<void> {
    const real = items.filter((item) => isSystemDrive(item.driveId));
    if (items.some((item) => item.archiveRoot)) throw new Error(tGlobal('zipReadOnly'));
    const virtual = items.filter((item) => !isSystemDrive(item.driveId));

    for (const item of virtual) {
      deleteItem(item.id, useRecycleBin);
    }

    const total = items.length || 1;
    let done = virtual.length;
    if (real.length === 0) {
      onProgress?.(total, total);
      return;
    }
    onProgress?.(done, total);

    const started = await callServerFs<{ jobId?: string }>('delete', {
      targets: real.map((item) => realAbsolutePath(item)),
      useTrash: useRecycleBin,
    });
    if (!started?.jobId) {
      const reason = lastCallError() || 'the local file service did not answer';
      throw new Error(`Delete could not start: ${reason}`);
    }

    const job = await awaitServerJob(started.jobId, undefined, signal, (snapshot) => {
      onProgress?.(done + (snapshot.itemsDone || 0), total);
      onFiles?.(snapshot.recentFiles || []);
    });
    if (job && job.status === 'done-with-errors') {
      throw new Error(job.errors[0]?.message || 'Delete failed');
    }

    // Mirror the removal in the overlay listing, then re-read from disk.
    for (const item of real) {
      const file = state.files.find((f) => f.id === item.id);
      if (!file) continue;
      if (file.isDirectory) {
        const dirPath = `${normalizePath(file.path)}\\${file.name}`;
        state.files = state.files.filter(
          (f) => !(f.driveId === file.driveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))),
        );
      }
      state.files = state.files.filter((f) => f.id !== file.id);
    }
    saveToStorage();

    const reloaded = new Set<string>();
    for (const item of real) {
      const key = `${item.driveId}|${normalizePath(item.path)}`;
      if (reloaded.has(key)) continue;
      reloaded.add(key);
      await loadSystemDriveDirectory(item.driveId, item.path);
    }

    done = total;
    onProgress?.(done, total);
  }

  function moveToRecycleBin(fileId: string): boolean {
    const file = state.files.find((f) => f.id === fileId);
    if (!file) return false;

    const binItem: RecycleBinItem = {
      id: `trash_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      originalId: file.id,
      originalPath: file.path,
      originalDriveId: file.driveId,
      deletedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      item: { ...file },
    };

    state.recycleBin.unshift(binItem);

    // Also add to TR: drive root virtual listing for seamless browsing
    file.driveId = 'drive_trash';
    file.path = 'TR:';

    if (file.isDirectory) {
      const dirPath = `${normalizePath(binItem.originalPath)}\\${file.name}`;
      state.files.forEach((f) => {
        if (f.driveId === binItem.originalDriveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))) {
          f.driveId = 'drive_trash';
          f.path = f.path.replace(binItem.originalDriveId, 'drive_trash');
        }
      });
    }

    saveToStorage();
    return true;
  }

  function restoreFromRecycleBin(recycleBinItemId: string): boolean {
    const binIndex = state.recycleBin.findIndex((b) => b.id === recycleBinItemId);
    if (binIndex === -1) return false;

    const binItem = state.recycleBin[binIndex];
    const file = state.files.find((f) => f.id === binItem.originalId);

    if (file) {
      file.driveId = binItem.originalDriveId;
      file.path = binItem.originalPath;

      if (file.isDirectory) {
        state.files.forEach((f) => {
          if (f.driveId === 'drive_trash') {
            f.driveId = binItem.originalDriveId;
          }
        });
      }
    } else {
      // Re-create if somehow unlisted
      state.files.push({
        ...binItem.item,
        driveId: binItem.originalDriveId,
        path: binItem.originalPath,
      });
    }

    state.recycleBin.splice(binIndex, 1);
    saveToStorage();
    return true;
  }

  function emptyRecycleBin() {
    state.files = state.files.filter((f) => f.driveId !== 'drive_trash');
    state.recycleBin = [];
    saveToStorage();
  }

  function getRecycleBinItems(): RecycleBinItem[] {
    return [...state.recycleBin];
  }

  function deletePermanentlyFromRecycleBin(recycleBinItemId: string) {
    const binIndex = state.recycleBin.findIndex((b) => b.id === recycleBinItemId);
    if (binIndex === -1) return;

    const binItem = state.recycleBin[binIndex];
    state.files = state.files.filter((f) => f.id !== binItem.originalId && f.driveId !== 'drive_trash');
    state.recycleBin.splice(binIndex, 1);
    saveToStorage();
  }

  return {
    createDirectory,
    createFile,
    saveFileContent,
    renameItem,
    deleteItem,
    deleteItems,
    moveToRecycleBin,
    restoreFromRecycleBin,
    emptyRecycleBin,
    getRecycleBinItems,
    deletePermanentlyFromRecycleBin,
  };
}
