import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem, CommandHistoryItem, FolderPasswordRecord, LanguageCode, ThemeId } from './types';
import { CleanupTargetId, fsEngine, type OpenableArchiveFormat } from './services/fileSystem';
import { themes, ThemeConfig } from './services/themeManager';
import { soundManager } from './services/soundEffects';
import { createPasswordRecord } from './services/appLock';
import { getTranslations, setCurrentLang } from './i18n/translations';

// Components
import { HeaderMenuBar } from './components/HeaderMenuBar';
import { AppModals } from './components/AppModals';
import { ConflictPromptModal } from './components/modals/ConflictPromptModal';
import { FreeSpaceModal } from './components/modals/FreeSpaceModal';
import { ZipPasswordModal } from './components/modals/ZipPasswordModal';
import { Toolbar } from './components/Toolbar';
import { DualPaneView } from './components/DualPaneView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useModalStack } from './hooks/useModalStack';
import { useSettings } from './hooks/useSettings';
import { useSplitter } from './hooks/useSplitter';
import { useDrives } from './hooks/useDrives';
import { useElevation } from './hooks/useElevation';
import { useAppLock } from './hooks/useAppLock';
import { usePanels } from './hooks/usePanels';
import { useCommandExecution } from './hooks/useCommandExecution';
import { useTransferQueue } from './hooks/useTransferQueue';

const AppLockModal = React.lazy(() =>
  import('./components/modals/AppLockModal').then((m) => ({ default: m.AppLockModal })),
);
import { CommandLineBar } from './components/CommandLineBar';
import { FunctionKeyBar } from './components/FunctionKeyBar';
import { FileContextMenu, type FileContextMenuState } from './components/FileContextMenu';
import { HoverPreviewTooltip } from './components/HoverPreviewTooltip';
import { CollapsibleInfoDrawer } from './components/CollapsibleInfoDrawer';

// Modals
import { taskQueue } from './services/taskQueueManager';
import { startTrayBridge } from './services/trayBridge';

export default function App() {
  // Global System Settings
  const { settings, setSettings } = useSettings();

  const currentTheme: ThemeConfig = themes[settings.theme] || themes.classic_blue;
  const fileSelectorPalette: Record<string, { cursor: string; selected: string }> = {
    blue: { cursor: '#00ffff', selected: '#0000aa' },
    amber: { cursor: '#f59e0b', selected: '#b45309' },
    cyan: { cursor: '#06b6d4', selected: '#155e75' },
    green: { cursor: '#22c55e', selected: '#14532d' },
    red: { cursor: '#ef4444', selected: '#7f1d1d' },
    purple: { cursor: '#a855f7', selected: '#581c87' },
  };
  const selectedSelectorPalette = fileSelectorPalette[settings.fileSelectorColor || 'blue'] || fileSelectorPalette.blue;
  const themeForFileList = {
    ...currentTheme,
    cursorBg: selectedSelectorPalette.cursor,
    selectedBg: selectedSelectorPalette.selected,
  };
  const lang: LanguageCode = settings.language;
  const t = getTranslations(lang);

  // Keep the module-level language store in sync for non-React consumers
  // (fsEngine, appLock, usePanels, ErrorBoundary, DriveBar). Set during render so
  // components rendered in this same pass already see the updated language.
  setCurrentLang(lang);

  // Keep the document language in sync for accessibility and search engines.
  // index.html ships lang="es"; without this the attribute would stay Spanish
  // no matter which language the user selects.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }

  // File system state
  const drives = useDrives();
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');

  // Hover Tooltip state
  const [hoveredItem, setHoveredItem] = useState<FileItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  // Real elevation and the one way to change it (an elevated relaunch).
  const { isElevated, requestElevation } = useElevation();

  // Quick Search state (Type-to-jump)
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');
  const quickSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leftTreePaneRef = useRef<HTMLDivElement | null>(null);
  const leftTreeTabRef = useRef<HTMLButtonElement | null>(null);

  // The lock only activates when a password hash exists, so `lock` refuses
  // without one; enabling it in Settings re-locks the session at once.
  const {
    isAppLocked,
    lock: lockApp,
    unlock: unlockApp,
  } = useAppLock({
    enabled: settings.appLockEnabled,
    passwordHash: settings.appPasswordHash,
  });

  // Password Unlock Flow state. What travels is the stored record, never the
  // password: the modal derives a hash from what the user types and compares it.
  const [unlockTarget, setUnlockTarget] = useState<{
    side: 'left' | 'right';
    path: string;
    record: FolderPasswordRecord;
  } | null>(null);

  // Active Modals & Operations.
  //
  // The dialogs own this state, and they read the selection through a ref: the
  // panel hook that provides the selection needs the modal setter in return, so
  // one of the two has to be late-bound.
  const selectionRef = useRef<() => FileItem[]>(() => []);
  const {
    activeModal,
    setActiveModal,
    modalData,
    setModalData,
    selectedFileForModal,
    setSelectedFileForModal,
    transferItems,
    handleTriggerCopy,
    handleTriggerMove,
    handleTriggerDelete,
  } = useModalStack(selectionRef);
  // Bumped to make the command console show its output drawer.
  const [consoleOpenNonce, setConsoleOpenNonce] = useState(0);
  // Bumped by the launcher's shortcut; the Run box owns what "open" means.
  const [runLauncherOpenRequest, setRunLauncherOpenRequest] = useState(0);
  // True while the launcher stands on its own because the toolbar is off.
  const [launcherOnly, setLauncherOnly] = useState(false);
  // Folder the cleanup modal was opened for, picked in the toolbar's cleanup menu.
  const [cleanupTarget, setCleanupTarget] = useState<CleanupTargetId>('user-temp');

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<FileContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetItem: null,
    panelSide: 'left',
  });

  // MS-DOS Command History
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);

  // Panels can be arranged side by side (the historical layout) or stacked,
  // which is what a wide monitor wants: two full-width panes instead of two
  // narrow columns. The splitter follows whichever axis is on screen.
  const stackedPanels = settings.splitLayout === 'vertical';

  // Manual Panel Resizing State
  const {
    isDraggingSplitter,
    setIsDraggingSplitter,
    ratio: dualPaneRatio,
  } = useSplitter(
    setSettings,
    stackedPanels ? (settings.dualPaneRatioRows ?? 50) : settings.dualPaneRatio || 50,
    stackedPanels,
  );

  // Sync with FileSystem changes
  const [fsTick, setFsTick] = useState(0);

  // A password request is a promise the panel awaits, so the modal has to settle
  // exactly once: with what the user typed, or with null when they cancel. The
  // promise lives in a ref because it is not render state -- what is rendered is
  // only the request being asked about.
  const pendingPassword = useRef<{ resolve: (value: string | null) => void } | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<{ fileName: string; invalid: boolean } | null>(null);

  const settlePassword = useCallback((value: string | null) => {
    const pending = pendingPassword.current;
    pendingPassword.current = null;
    setPasswordRequest(null);
    pending?.resolve(value);
  }, []);

  const requestArchivePassword = useCallback(
    (fileName: string, invalid?: boolean): Promise<string | null> =>
      new Promise((resolve) => {
        // A second archive opened while the modal is up cancels the first ask,
        // so no promise is left waiting on a prompt that is no longer shown.
        pendingPassword.current?.resolve(null);
        pendingPassword.current = { resolve };
        setPasswordRequest({ fileName, invalid: Boolean(invalid) });
      }),
    [],
  );

  const {
    leftPanel,
    setLeftPanel,
    rightPanel,
    setRightPanel,
    isLeftFilterOpen,
    setIsLeftFilterOpen,
    isRightFilterOpen,
    setIsRightFilterOpen,
    handleSwapPanels,
    activePanelState,
    inactivePanelState,
    currentActiveTab,
    currentInactiveTab,
    currentActiveDrive,
    currentInactiveDrive,
    leftTab,
    rightTab,
    leftItems,
    rightItems,
    activeItems,
    activeFocusedItem,
    activeSelectedBytes,
    handleNavigate,
    handleSelectTab,
    handleNewTab,
    handleCloseTab,
    handleToggleLockTab,
    handleDuplicateTab,
    handleGoParent,
    handleGoBack,
    handleGoForward,
    handleSelectDrive,
    handleSelectIndex,
    handleToggleSelect,
    handleSelectAll,
    handleInvertSelection,
    handleOpenItem,
    handleLeftGoParent,
    handleRightGoParent,
    handleLeftRefresh,
    handleRightRefresh,
    handleLeftSort,
    handleRightSort,
    handleLeftSelectIndex,
    handleRightSelectIndex,
    handleLeftToggleSelect,
    handleRightToggleSelect,
    handleLeftContextMenu,
    handleRightContextMenu,
    handleLeftItemHover,
    handleRightItemHover,
  } = usePanels({
    drives,
    settings,
    activePanel,
    activeModal,
    setQuickSearchQuery,
    quickSearchTimerRef,
    setActiveModal,
    setSelectedFileForModal,
    setUnlockTarget,
    setHoveredItem,
    setHoverPos,
    setContextMenuState,
    fsTick,
    setFsTick,
    requestArchivePassword,
  });

  const { handleExecuteCommand } = useCommandExecution({
    lang,
    activeItems,
    currentActiveTab,
    activePanel,
    isAdminMode: isElevated,
    handleGoParent: activePanel === 'left' ? handleLeftGoParent : handleRightGoParent,
    handleNavigate: (side, path) => handleNavigate(side, path),
    setCommandHistory,
  });

  useEffect(() => {
    return fsEngine.subscribe(() => {
      setFsTick((t) => t + 1);
    });
  }, []);

  // The tray mirrors the live transfer and turns its menu picks into the same
  // pause/resume/cancel the in-window bar calls. Restarting on a language change
  // relabels the menu; the subscription itself is cheap either way.
  useEffect(() => startTrayBridge(lang), [lang]);

  // One-time migration: replace any legacy plaintext password with a salted
  // PBKDF2 hash so it is never persisted in clear. The removed `admin123`
  // default is dropped outright: it was a public master key, so hashing it
  // would silently reintroduce the bypass it came from.
  const passwordMigratedRef = useRef(false);
  useEffect(() => {
    if (passwordMigratedRef.current) return;
    passwordMigratedRef.current = true;
    if (settings.appPasswordHash === 'admin123' && !settings.appPasswordSalt) {
      setSettings((s) => ({ ...s, appPasswordHash: '', appPasswordSalt: '' }));
      return;
    }
    if (settings.appPasswordHash && !settings.appPasswordSalt) {
      createPasswordRecord(settings.appPasswordHash)
        .then((record) => setSettings((s) => ({ ...s, appPasswordHash: record.hash, appPasswordSalt: record.salt })))
        .catch(() => {});
    }
  }, []);

  // Triggers
  const getSelectedOrFocusedItems = (): FileItem[] => {
    const selected = activeItems.filter((i) => currentActiveTab.selectedIds.includes(i.id));
    if (selected.length > 0) return selected;
    if (activeFocusedItem) return [activeFocusedItem];
    return [];
  };

  // The hook snapshots the selection through this ref, so it has to point at the
  // live one: the panel hook above is what knows what is selected.
  selectionRef.current = getSelectedOrFocusedItems;

  /**
   * Forgets pinned folders the tree found deleted on disk. Called from the tree,
   * so it stays stable: an inline handler would restart the tree's existence
   * check on every render.
   */
  const handleMissingFavorites = useCallback(
    (missing: string[]) => {
      if (missing.length === 0) return;
      const gone = new Set(missing.map((entry) => entry.toLowerCase()));
      setSettings((current) => {
        const pinned = current.favoriteFolders ?? [];
        const kept = pinned.filter((entry) => !gone.has(entry.toLowerCase()));
        return kept.length === pinned.length ? current : { ...current, favoriteFolders: kept };
      });
    },
    [setSettings],
  );

  // Keyboard navigation engine
  useKeyboardShortcuts({
    activePanel,
    // While a panel shows the folder-size tree, its file shortcuts must not
    // reach the list hidden behind it.
    activePanelShowsDiskUsage: activePanelState.panelView === 'diskUsage',
    currentActiveTab,
    activeItems,
    activeFocusedItem,
    activeModal,
    isAppLocked,
    drives,
    leftTab,
    rightTab,
    quickSearchQuery,
    quickSearchTimerRef,
    setActivePanel,
    setActiveModal,
    setSelectedFileForModal,
    setQuickSearchQuery,
    setLeftPanel,
    setRightPanel,
    setIsLeftFilterOpen,
    setIsRightFilterOpen,
    handleTriggerCopy,
    handleTriggerMove,
    handleTriggerDelete,
    handleSelectDrive,
    handleNewTab,
    handleCloseTab,
    handleSelectAll,
    handleSwapPanels,
    handleSelectIndex,
    handleToggleSelect,
    handleOpenItem,
    handleGoParent,
    handleOpenRunLauncher: () => {
      // The line must stay reachable with the toolbar switched off. It comes
      // alone in that case, instead of turning the whole row back on.
      if (!settings.showToolbar) setLauncherOnly(true);
      setRunLauncherOpenRequest((request) => request + 1);
    },
  });

  const {
    conflictPrompt,
    freeSpacePrompt,
    dismissFreeSpacePrompt,
    handleResolveConflict,
    handleAbortConflict,
    handleForceTransfer,
    handleRunCopyList,
    handleElevateTransfer,
    handleConfirmCopy,
    handleConfirmMove,
  } = useTransferQueue({
    lang,
    transferItems,
    currentActiveTab,
    currentInactiveTab,
    setFsTick,
  });

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
      async () => {
        await fsEngine.extractArchive(source, destination.driveId, destination.currentPath);
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

  useEffect(() => {
    if (!leftPanel.isTreeVisible) return;
    const onPointerDown = (e: MouseEvent) => {
      if (isDraggingSplitter) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (leftTreePaneRef.current?.contains(target)) return;
      if (leftTreeTabRef.current?.contains(target)) return;
      setLeftPanel((p) => ({ ...p, isTreeVisible: false }));
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [leftPanel.isTreeVisible, isDraggingSplitter]);

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden font-mono select-none relative"
      style={{
        backgroundColor: currentTheme.bgApp,
        color: currentTheme.itemText,
      }}
    >
      {/* Retro CRT Monitor Scanline & Vignette Overlay */}
      {settings.crtEffectEnabled && (
        <div
          className={`fixed inset-0 pointer-events-none z-[9999] ${
            settings.crtIntensity === 'subtle'
              ? 'crt-overlay-subtle'
              : settings.crtIntensity === 'intense'
                ? 'crt-overlay-intense'
                : 'crt-overlay-classic'
          }`}
        />
      )}
      {/* App Lock Overlay if app lock active. It sits above the modal layer
          (ModalShell renders at z-[60] and Settings is mounted later in the tree)
          because enabling the lock from Settings leaves that dialog open: the
          lock has to cover it, not hide underneath it. */}
      {isAppLocked && (
        <div className="fixed inset-0 z-[70]">
          <AppLockModal
            theme={currentTheme}
            lang={lang}
            expectedUser={settings.appUsername || 'admin'}
            expectedPassHash={settings.appPasswordHash}
            expectedPassSalt={settings.appPasswordSalt}
            onUnlockSuccess={unlockApp}
          />
        </div>
      )}

      {/* 1. Retro Pull-down Menu Bar */}
      <HeaderMenuBar
        theme={currentTheme}
        lang={lang}
        showClock={settings.showClock}
        clockPosition={settings.clockPosition}
        hoverOpen={settings.menuBarHoverOpen}
        crtEffectEnabled={settings.crtEffectEnabled}
        onToggleCrt={() => setSettings((s) => ({ ...s, crtEffectEnabled: !s.crtEffectEnabled }))}
        onOpenModal={(m) => {
          if (m === 'viewer' || m === 'editor' || m === 'checksum' || m === 'properties') {
            if (activeFocusedItem) setSelectedFileForModal(activeFocusedItem);
          }
          if (m === 'app_lock') {
            lockApp();
            return;
          }
          setActiveModal(m);
        }}
        onRefresh={() => {
          soundManager.playKeyTick();
          setFsTick((t) => t + 1);
        }}
        onSelectAll={handleSelectAll}
        onInvertSelection={handleInvertSelection}
        onToggleQuickView={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setRightPanel : setLeftPanel;
          targetSet((p) => ({ ...p, isQuickView: !p.isQuickView }));
        }}
        onToggleTree={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setLeftPanel : setRightPanel;
          targetSet((p) => ({ ...p, isTreeVisible: !p.isTreeVisible }));
        }}
        onSwapPanels={handleSwapPanels}
        onNewTab={(side) => handleNewTab(side)}
        onChangeDrive={(side, dId) => handleSelectDrive(side, dId)}
        activePanel={activePanel}
        isQuickView={inactivePanelState.isQuickView}
        isTreeVisible={activePanelState.isTreeVisible}
        onSetTheme={(themeId: ThemeId) => setSettings((s) => ({ ...s, theme: themeId }))}
        onSetLang={(newLang: LanguageCode) => setSettings((s) => ({ ...s, language: newLang }))}
        onResetDefaults={() => {
          if (confirm(t.appResetConfirm)) {
            fsEngine.resetToDefaults();
          }
        }}
        onMinimizeWindow={() => {
          const api = window.electronAPI;
          if (api?.minimizeWindow) api.minimizeWindow();
        }}
        onMaximizeWindow={() => {
          const api = window.electronAPI;
          if (api?.maximizeWindow) api.maximizeWindow();
        }}
        onCloseWindow={() => {
          const api = window.electronAPI;
          if (api?.closeWindow) api.closeWindow();
          else window.close();
        }}
      />

      <Toolbar
        currentTheme={currentTheme}
        t={t}
        showToolbar={settings.showToolbar}
        toolbarItems={settings.toolbarItems}
        activePanel={activePanel}
        leftTab={leftTab}
        rightTab={rightTab}
        setLeftPanel={setLeftPanel}
        setRightPanel={setRightPanel}
        setFsTick={setFsTick}
        activeFocusedItem={activeFocusedItem}
        setSelectedFileForModal={setSelectedFileForModal}
        setActiveModal={setActiveModal}
        onCleanup={(target) => {
          setCleanupTarget(target);
          setActiveModal('cleanup');
        }}
        rightPanelShowsDiskUsage={rightPanel.panelView === 'diskUsage'}
        onNavigate={handleNavigate}
        runLauncherOpenRequest={runLauncherOpenRequest}
        launcherOnly={launcherOnly}
        onLauncherDismiss={() => setLauncherOnly(false)}
        panelStacked={stackedPanels}
        onTogglePanelLayout={() =>
          setSettings((s) => ({ ...s, splitLayout: s.splitLayout === 'vertical' ? 'horizontal' : 'vertical' }))
        }
        onToggleRightPanelDiskUsage={() =>
          setRightPanel((p) => ({ ...p, panelView: p.panelView === 'diskUsage' ? 'files' : 'diskUsage' }))
        }
      />

      {/* 2. Main Dual-Panel Viewport */}

      <DualPaneView
        theme={currentTheme}
        themeForFileList={themeForFileList}
        lang={lang}
        settings={settings}
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        quickSearchQuery={quickSearchQuery}
        drives={drives}
        stacked={stackedPanels}
        ratio={dualPaneRatio}
        dragging={isDraggingSplitter}
        onDragStart={() => setIsDraggingSplitter(true)}
        handlers={{
          navigate: handleNavigate,
          selectDrive: handleSelectDrive,
          selectTab: handleSelectTab,
          newTab: handleNewTab,
          closeTab: handleCloseTab,
          toggleLockTab: handleToggleLockTab,
          duplicateTab: handleDuplicateTab,
          goBack: handleGoBack,
          goForward: handleGoForward,
          dropItems: handleDropItems,
          dropNativeFiles: handleDropNativeFiles,
          openItem: handleOpenItem,
        }}
        left={{
          panel: leftPanel,
          setPanel: setLeftPanel,
          tab: leftTab,
          items: leftItems,
          otherItems: rightItems,
          otherTab: rightTab,
          drive: currentActiveDrive,
          isFilterOpen: isLeftFilterOpen,
          setIsFilterOpen: setIsLeftFilterOpen,
          treePaneRef: leftTreePaneRef,
          treeVisible: leftPanel.isTreeVisible,
          onToggleTree: () => setLeftPanel((p) => ({ ...p, isTreeVisible: !p.isTreeVisible })),
          onRefresh: handleLeftRefresh,
          onMissingFavorites: handleMissingFavorites,
          onGoParent: handleLeftGoParent,
          onSort: handleLeftSort,
          onSelectIndex: handleLeftSelectIndex,
          onToggleSelect: handleLeftToggleSelect,
          onContextMenu: handleLeftContextMenu,
          onItemHover: handleLeftItemHover,
        }}
        right={{
          panel: rightPanel,
          setPanel: setRightPanel,
          tab: rightTab,
          items: rightItems,
          otherItems: leftItems,
          otherTab: leftTab,
          drive: currentInactiveDrive,
          isFilterOpen: isRightFilterOpen,
          setIsFilterOpen: setIsRightFilterOpen,
          onRefresh: handleRightRefresh,
          onGoParent: handleRightGoParent,
          onSort: handleRightSort,
          onSelectIndex: handleRightSelectIndex,
          onToggleSelect: handleRightToggleSelect,
          onContextMenu: handleRightContextMenu,
          onItemHover: handleRightItemHover,
        }}
      />

      {/* 3. Collapsible Info & System Performance Drawer */}
      {settings.showCollapsibleInfoDrawer && (
        <CollapsibleInfoDrawer
          lang={lang}
          theme={currentTheme}
          activeDrive={currentActiveDrive}
          activePath={currentActiveTab.currentPath}
          focusedItem={activeFocusedItem}
          selectedCount={currentActiveTab.selectedIds.length}
          totalItemsCount={activeItems.length}
          totalSelectedBytes={activeSelectedBytes}
          isAdminMode={isElevated}
          onToggleAdminMode={requestElevation}
          onLockApp={lockApp}
          isFolderProtected={
            !!(
              settings.protectedFolders &&
              currentActiveTab?.currentPath &&
              settings.protectedFolders[currentActiveTab.currentPath]
            )
          }
          onProtectFolder={() => setActiveModal('protect_folder')}
          showClock={settings.showClock}
          clockPosition={settings.clockPosition}
        />
      )}

      {/* 4. MS-DOS & Admin Command Line Prompt Bar */}
      {settings.showCommandLine && (
        <CommandLineBar
          lang={lang}
          theme={currentTheme}
          currentPath={currentActiveTab.currentPath}
          onExecuteCommand={handleExecuteCommand}
          logOpenNonce={consoleOpenNonce}
          commandHistory={commandHistory}
          onClearHistory={() => setCommandHistory([])}
          isAdminMode={isElevated}
          onToggleAdminMode={requestElevation}
          availableItems={activeItems}
        />
      )}

      {/* 5. Bottom F1..F10 Function Key Bar */}
      {settings.showFunctionBar && (
        <FunctionKeyBar
          theme={currentTheme}
          lang={lang}
          // Same condition as the keyboard: with the size tree on screen the
          // file keys have nothing visible to act on.
          fileActionsDisabled={activePanelState.panelView === 'diskUsage'}
          onOpenModal={(m) => {
            if (m === 'viewer' || m === 'editor' || m === 'checksum' || m === 'properties') {
              if (activeFocusedItem) setSelectedFileForModal(activeFocusedItem);
            }
            setActiveModal(m);
          }}
          onCopy={handleTriggerCopy}
          onMove={handleTriggerMove}
          onDelete={handleTriggerDelete}
          onMkDir={() => setActiveModal('mkdir')}
          onView={() => {
            if (activeFocusedItem) {
              setSelectedFileForModal(activeFocusedItem);
              setActiveModal('viewer');
            }
          }}
          onEdit={() => {
            if (activeFocusedItem && !activeFocusedItem.isDirectory) {
              setSelectedFileForModal(activeFocusedItem);
              setActiveModal('editor');
            }
          }}
        />
      )}

      {/* 6. Hover Preview Tooltip & Image Thumbnail */}
      {settings.showHoverTooltips && hoveredItem && (
        <HoverPreviewTooltip
          lang={lang}
          theme={currentTheme}
          item={hoveredItem}
          x={hoverPos.x}
          y={hoverPos.y}
          showThumbnail={settings.showImageHoverThumbnails}
        />
      )}

      {/* 7. Context Menu */}
      <FileContextMenu
        theme={currentTheme}
        lang={lang}
        state={contextMenuState}
        settings={settings}
        currentActiveTab={currentActiveTab}
        leftTab={leftTab}
        rightTab={rightTab}
        onClose={() => setContextMenuState((s) => ({ ...s, visible: false }))}
        setSelectedFileForModal={setSelectedFileForModal}
        setActiveModal={setActiveModal}
        setModalData={setModalData}
        setSettings={setSettings}
        onCopy={handleTriggerCopy}
        onMove={handleTriggerMove}
        onDelete={handleTriggerDelete}
        onRefresh={() => setFsTick((tick) => tick + 1)}
        onShowConsole={() => setConsoleOpenNonce((nonce) => nonce + 1)}
        onExecuteCommand={handleExecuteCommand}
      />

      <AppModals
        currentTheme={currentTheme}
        lang={lang}
        selectedFileForModal={selectedFileForModal}
        setActiveModal={setActiveModal}
        activeModal={activeModal}
        cleanupTarget={cleanupTarget}
        modalData={modalData?.items?.length ? modalData : { ...modalData, items: transferItems }}
        setModalData={setModalData}
        onRunCopyList={handleRunCopyList}
        currentActiveTab={currentActiveTab}
        currentInactiveTab={currentInactiveTab}
        activePanel={activePanel}
        activeItems={activeItems}
        activeFocusedItem={activeFocusedItem}
        leftTab={leftTab}
        rightTab={rightTab}
        leftItems={leftItems}
        rightItems={rightItems}
        drives={drives}
        settings={settings}
        setSettings={setSettings}
        unlockTarget={unlockTarget}
        setUnlockTarget={setUnlockTarget}
        setLeftPanel={setLeftPanel}
        setRightPanel={setRightPanel}
        setFsTick={setFsTick}
        handleConfirmCopy={handleConfirmCopy}
        handleConfirmMove={handleConfirmMove}
        handleElevateTransfer={handleElevateTransfer}
        handleConfirmDelete={handleConfirmDelete}
        handleConfirmMkDir={handleConfirmMkDir}
        handleConfirmNewFile={handleConfirmNewFile}
        handleConfirmRename={handleConfirmRename}
        handleConfirmSendToFolder={handleConfirmSendToFolder}
        handleApplyBatchRename={handleApplyBatchRename}
        getSelectedOrFocusedItems={getSelectedOrFocusedItems}
        handleNavigate={handleNavigate}
        handleSelectIndex={handleSelectIndex}
        handleCompressZip={handleCompressZip}
        handleExtractZip={handleExtractZip}
        handleSetFolderPassword={handleSetFolderPassword}
        handleExecuteCommand={handleExecuteCommand}
      />

      {conflictPrompt && (
        <ConflictPromptModal
          conflict={conflictPrompt}
          theme={currentTheme}
          lang={lang}
          onAnswer={handleResolveConflict}
          onCancel={handleAbortConflict}
        />
      )}

      {freeSpacePrompt && (
        <FreeSpaceModal
          volumes={freeSpacePrompt.volumes}
          theme={currentTheme}
          lang={lang}
          onForce={handleForceTransfer}
          onCancel={dismissFreeSpacePrompt}
        />
      )}

      {passwordRequest && (
        <ZipPasswordModal
          theme={currentTheme}
          lang={lang}
          fileName={passwordRequest.fileName}
          invalid={passwordRequest.invalid}
          onSubmit={settlePassword}
          onClose={() => settlePassword(null)}
        />
      )}

      <button
        ref={leftTreeTabRef}
        onClick={() => setLeftPanel((p) => ({ ...p, isTreeVisible: !p.isTreeVisible }))}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-[10000] w-6 h-14 rounded-r-md border border-l-0 text-[11px] font-bold flex items-center justify-center cursor-pointer shadow-lg"
        style={{
          backgroundColor: currentTheme.headerBg,
          color: currentTheme.headerText,
          borderColor: currentTheme.borderPanel,
        }}
        title={t.toggleTreeTooltip}
      >
        {leftPanel.isTreeVisible ? '◁' : '▷'}
      </button>
    </div>
  );
}
