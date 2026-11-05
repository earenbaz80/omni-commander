import type { FileItem, FileProgressEntry, PendingConflict, TransferOptions } from '../types';
import type { CatalogueState } from './fileCatalog';
import { log } from '../utils/logger';
import { tGlobal } from '../i18n/translations';

/**
 * What copy and move need from the engine, named one by one.
 *
 * Both operations only restructure the catalogue: a virtual entry is copied or
 * re-pathed here, while a real drive is handed to the server and mirrored back.
 * The archive overlay is the one exception — copying out of a mounted archive is
 * really an extraction, so that path is handed over instead of reimplemented.
 */
export interface CopyMoveDeps {
  state: CatalogueState;
  normalizePath: (path: string) => string;
  isSystemDrive: (driveId: string) => boolean;
  getArchiveSource: (driveId: string, path: string) => FileItem | undefined;
  getFileById: (id: string) => FileItem | undefined;
  extractArchive: (
    archiveFile: FileItem,
    targetDriveId: string,
    targetPath: string,
    selectedEntry?: string,
  ) => Promise<number>;
  realCopyOrMove: (
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
  ) => Promise<FileItem | undefined>;
  saveToStorage: () => void;
}

/**
 * Copying and moving entries that live only in the catalogue.
 *
 * Children are collected before anything is pushed, which is the fix for a race
 * that once copied a folder into itself; and a collision is never resolved here
 * — overwriting and renaming to `_Copy` are both decisions the caller asked for.
 */
export function createCopyMoveOps(deps: CopyMoveDeps) {
  const {
    state,
    normalizePath,
    isSystemDrive,
    getArchiveSource,
    getFileById,
    extractArchive,
    realCopyOrMove,
    saveToStorage,
  } = deps;

  async function copyItem(
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
    if (getArchiveSource(targetDriveId, targetPath)) throw new Error(tGlobal('zipReadOnly'));
    const file = getFileById(fileId);
    if (file?.archiveRoot) {
      const source = getArchiveSource(file.driveId, file.path)!;
      await extractArchive(source, targetDriveId, targetPath, file.archiveEntry);
      return file;
    }
    if (!file) {
      log.warn('Copy skipped: no catalogue entry for', fileId);
      return undefined;
    }

    // Real drives are written by the local server, never simulated in memory.
    if (isSystemDrive(file.driveId) || isSystemDrive(targetDriveId)) {
      return realCopyOrMove(
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

    const normTarget = normalizePath(targetPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (file.isDirectory) {
      const oldDirPath = `${normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normTarget}\\${file.name}`;

      // Collect children BEFORE pushing new items (fixes race condition)
      const children = state.files.filter(
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
      state.files.push(newDir);

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
        state.files.push(newChild);
        transferred += child.size || 0;
        if (onProgress) onProgress(transferred, total);
      }

      saveToStorage();
      return newDir;
    } else {
      // Check existing in target
      const existing = state.files.find(
        (f) =>
          f.driveId === targetDriveId &&
          normalizePath(f.path) === normTarget &&
          f.name === file.name &&
          f.ext === file.ext,
      );
      if (existing) {
        if (overwrite) {
          existing.content = file.content;
          existing.size = file.size;
          existing.modifiedAt = now;
          saveToStorage();
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
          state.files.push(newFile);
          saveToStorage();
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
        state.files.push(newFile);
        saveToStorage();
        if (onProgress) onProgress(file.size || 0, file.size || 0);
        return newFile;
      }
    }
  }

  async function moveItem(
    fileId: string,
    targetDriveId: string,
    targetPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
  ): Promise<boolean> {
    if (getFileById(fileId)?.archiveRoot || getArchiveSource(targetDriveId, targetPath))
      throw new Error(tGlobal('zipReadOnly'));
    const file = state.files.find((f) => f.id === fileId);
    if (!file) {
      log.warn('Move skipped: no catalogue entry for', fileId);
      return false;
    }

    // Real drives are written by the local server, never simulated in memory.
    if (isSystemDrive(file.driveId) || isSystemDrive(targetDriveId)) {
      await realCopyOrMove(
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

    const normTarget = normalizePath(targetPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (file.isDirectory) {
      const oldDirPath = `${normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normTarget}\\${file.name}`;

      // Collect children BEFORE modifying (fixes race condition)
      const children = state.files.filter(
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

    saveToStorage();
    if (onProgress) onProgress(1, 1);
    return true;
  }

  return { copyItem, moveItem };
}
