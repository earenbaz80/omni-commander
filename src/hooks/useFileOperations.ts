import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { FileItem, LanguageCode, PanelState, PanelTab, UserSettings } from '../types';
import { fsEngine, type OpenableArchiveFormat } from '../services/fileSystem';
import { taskQueue } from '../services/taskQueueManager';
import { soundManager } from '../services/soundEffects';
import { createPasswordRecord } from '../services/appLock';
import { getTranslations } from '../i18n/translations';

export interface FileOperationsDeps {
  lang: LanguageCode;
  /** What the open dialogs act on: their own snapshot of the selection. */
  transferItems: FileItem[];
  currentActiveTab: PanelTab;
  currentInactiveTab: PanelTab;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  selectedFileForModal: FileItem | null;
  /** Only the one field this hook reads: where "send to" is aiming. */
  modalData: { sendToDriveId?: string } | null;
  setActiveModal: (modal: null) => void;
  setLeftPanel: Dispatch<SetStateAction<PanelState>>;
  setRightPanel: Dispatch<SetStateAction<PanelState>>;
  setFsTick: Dispatch<SetStateAction<number>>;
  getSelectedOrFocusedItems: () => FileItem[];
}

export interface FileOperations {
  handleConfirmDelete: () => void;
  handleConfirmSendToFolder: (folderPath: string) => Promise<void>;
  handleConfirmRename: (newName: string) => void;
  handleConfirmMkDir: (dirName: string) => void;
  handleConfirmNewFile: (fileName: string) => void;
  handleApplyBatchRename: (renames: { id: string; newName: string }[]) => void;
  handleCompressZip: (archiveName: string, format: OpenableArchiveFormat) => Promise<void>;
  handleExtractZip: (zipFile: FileItem) => Promise<void>;
  handleDropItems: (
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation?: 'copy' | 'move',
  ) => void;
  handleDropNativeFiles: (files: globalThis.FileList, targetPath: string, targetDriveId: string) => Promise<void>;
  handleSetFolderPassword: (folderPath: string, password: string | null) => Promise<void>;
}

/**
 * The operations a dialog confirms or a drop starts: delete, rename, create,
 * compress, extract, send to and the folder password.
 *
 * They all share one shape — take what the user chose, run it, and refresh the
 * panes — and none of them is state the window owns. What travels in is the
 * dialog's own snapshot of the selection, so a refresh that lands while a dialog
 * is open cannot redirect an operation the user already confirmed.
 */
export function useFileOperations({
  lang,
  transferItems,
  currentActiveTab,
  currentInactiveTab,
  settings,
  setSettings,
  selectedFileForModal,
  modalData,
  setActiveModal,
  setLeftPanel,
  setRightPanel,
  setFsTick,
  getSelectedOrFocusedItems,
}: FileOperationsDeps): FileOperations {
  const t = getTranslations(lang);

  const handleConfirmDelete = () => {
    const items: FileItem[] = transferItems;
    const useTrash = settings.useRecycleBin !== false;
    const startedAt = Date.now();
    const totalEntries = items.length || 1;
    let taskId = '';

    // A delete moves no bytes, so progress is measured in entries and the ETA is
    // derived from the entry rate instead of a byte throughput.
    const executor = async (
      onProgress: (transferred: number, total: number) => void,
      signal: { paused: boolean; cancelled: boolean },
    ) => {
      try {
        await fsEngine.deleteItems(
          items,
          useTrash,
          (done, total) => {
            onProgress(done, total);
            const elapsed = (Date.now() - startedAt) / 1000;
            const rate = elapsed > 0 ? done / elapsed : 0;
            taskQueue.updateTaskMeta(taskId, {
              etaSeconds: rate > 0 && total > done ? Math.round((total - done) / rate) : 0,
            });
          },
          signal,
          (files) => taskQueue.updateTaskFiles(taskId, files),
        );
      } catch (e) {
        console.error('Delete failed', e);
        const reason = e instanceof Error ? e.message : 'Delete failed';
        taskQueue.updateTaskMeta(taskId, { error: reason });
        // A delete that threw must end failed. Resolving here marked it
        // completed at 100% with the reason stored where nothing rendered it.
        throw e instanceof Error ? e : new Error(reason);
      }
    };

    taskId = taskQueue.addTask(
      'delete',
      `${useTrash ? t.appSendingTrash : t.appDeleting} ${t.appItemsCount.replace('{n}', String(items.length))}`,
      undefined,
      totalEntries,
      executor,
    );
    // A delete has no byte throughput, so clear the misleading "0 MB/s" readout.
    taskQueue.updateTaskMeta(taskId, { speed: '' });
    soundManager.playSuccess();
    setActiveModal(null);
  };

  const handleConfirmSendToFolder = async (folderPath: string) => {
    const item = selectedFileForModal;
    const driveId = modalData?.sendToDriveId;
    setActiveModal(null);
    if (!item || !driveId) return;
    const created = await fsEngine.sendToFolder(driveId, folderPath, item);
    if (created) {
      soundManager.playSuccess();
      // Only a folder the copy actually reached is worth remembering; a refused
      // destination would otherwise become the default and fail again.
      setSettings((prev) => ({ ...prev, sendToLastFolder: folderPath }));
    } else {
      alert(fsEngine.lastServerError || 'No se pudo copiar el elemento');
    }
  };

  const handleConfirmRename = (newName: string) => {
    const target = selectedFileForModal;
    if (!target) return;
    try {
      fsEngine.renameItem(target.id, newName);
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleConfirmMkDir = (dirName: string) => {
    try {
      fsEngine.createDirectory(currentActiveTab.driveId, currentActiveTab.currentPath, dirName);
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleConfirmNewFile = (fileName: string) => {
    try {
      fsEngine.createFile(currentActiveTab.driveId, currentActiveTab.currentPath, fileName, '');
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleApplyBatchRename = (renames: { id: string; newName: string }[]) => {
    renames.forEach((r) => {
      fsEngine.renameItem(r.id, r.newName);
    });
    setActiveModal(null);
  };

  const handleCompressZip = async (archiveName: string, format: OpenableArchiveFormat) => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    const totalBytes = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
    taskQueue.addTask(
      'archive',
      t.appPacking.replace('{name}', archiveName),
      t.appItemsCount.replace('{n}', String(items.length)),
      totalBytes,
      async () => {
        await fsEngine.createArchive(
          items,
          archiveName,
          currentActiveTab.driveId,
          currentActiveTab.currentPath,
          format,
        );
      },
    );
    setActiveModal(null);
  };

  const handleExtractZip = async (zipFile: FileItem) => {
    const mounted = fsEngine.getArchiveSource(currentActiveTab.driveId, currentActiveTab.currentPath);
    const source = mounted || zipFile;
    const destination = mounted ? currentInactiveTab : currentActiveTab;
    taskQueue.addTask(
      'extract',
      t.appUnpacking.replace('{name}', `${source.name}.${source.ext}`),
      t.appDest.replace('{path}', destination.currentPath),
      source.size,
      // The bar follows the bytes that reach the disk. Without this an extraction
      // sat at 0% for its whole run, which for a member of gigabytes looked like
      // the app had hung.
      async (onProgress) => {
        await fsEngine.extractArchive(source, destination.driveId, destination.currentPath, undefined, onProgress);
      },
    );
    setActiveModal(null);
  };

  const handleDropItems = useCallback(
    (draggedItems: FileItem[], targetPath: string, targetDriveId: string, operation: 'copy' | 'move' = 'copy') => {
      soundManager.playDiskAccess();
      const totalBytes = draggedItems.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
      taskQueue.addTask(
        operation === 'move' ? 'move' : 'copy',
        (operation === 'move' ? t.appMovingDrag : t.appCopyingDrag).replace('{n}', String(draggedItems.length)),
        t.appDest.replace('{path}', targetPath),
        totalBytes,
        async () => {
          if (fsEngine.getArchiveSource(targetDriveId, targetPath)) throw new Error(t.zipReadOnly);
          const movedIds = new Set(draggedItems.map((i) => i.id));
          for (const item of draggedItems) {
            // Real-drive entries are written by the server and addressed by
            // absolute path. The catalogue id is only needed for simulated items,
            // and a listing refresh mid-drag can invalidate it.
            if (fsEngine.isRealFile(item)) {
              const isSameDir = item.driveId === targetDriveId && item.path === targetPath;
              await fsEngine.transferPaths(operation, [fsEngine.absolutePathOf(item)], targetPath, !isSameDir);
            } else if (operation === 'move') {
              await fsEngine.moveItem(item.id, targetDriveId, targetPath);
            } else {
              const isSameDir = item.driveId === targetDriveId && item.path === targetPath;
              await fsEngine.copyItem(item.id, targetDriveId, targetPath, !isSameDir);
            }
          }

          if (operation === 'move') {
            setLeftPanel((p) => ({
              ...p,
              tabs: p.tabs.map((tab) => ({
                ...tab,
                selectedIds: tab.selectedIds.filter((id) => !movedIds.has(id)),
              })),
            }));
            setRightPanel((p) => ({
              ...p,
              tabs: p.tabs.map((tab) => ({
                ...tab,
                selectedIds: tab.selectedIds.filter((id) => !movedIds.has(id)),
              })),
            }));
            // Move-success feedback belongs to a completed move only; a copy has its
            // own completion signal and must not play the move sound.
            soundManager.playSuccess();
          }
          // Both operations refresh the panes once the transfer actually finished.
          setFsTick((t) => t + 1);
        },
      );
    },
    [t],
  );

  const handleDropNativeFiles = useCallback(
    async (files: globalThis.FileList, targetPath: string, targetDriveId: string) => {
      soundManager.playDiskAccess();
      for (let i = 0; i < files.length; i++) {
        await fsEngine.importBrowserFile(files[i], targetDriveId, targetPath);
      }
      setFsTick((t) => t + 1);
    },
    [],
  );

  // Password Folder Protection Handler. Settings are stored as JSON in
  // localStorage, so what goes in has to be the derived record and not the
  // password: the same PBKDF2 the app lock uses, with its own salt per folder.
  const handleSetFolderPassword = async (folderPath: string, password: string | null) => {
    const record = password ? await createPasswordRecord(password) : null;
    setSettings((prev) => {
      const updated = { ...(prev.protectedFolders || {}) };
      if (record) {
        updated[folderPath] = record;
      } else {
        delete updated[folderPath];
      }
      return { ...prev, protectedFolders: updated };
    });
  };

  return {
    handleConfirmDelete,
    handleConfirmSendToFolder,
    handleConfirmRename,
    handleConfirmMkDir,
    handleConfirmNewFile,
    handleApplyBatchRename,
    handleCompressZip,
    handleExtractZip,
    handleDropItems,
    handleDropNativeFiles,
    handleSetFolderPassword,
  };
}
