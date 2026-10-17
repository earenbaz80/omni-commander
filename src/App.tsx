import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem, Drive, ActiveModal, CommandHistoryItem, LanguageCode, ThemeId } from './types';
import { fsEngine } from './services/fileSystem';
import { themes, ThemeConfig } from './services/themeManager';
import { soundManager } from './services/soundEffects';
import { createPasswordRecord } from './services/appLock';
import { getTranslations, setCurrentLang } from './i18n/translations';

// Components
import { HeaderMenuBar } from './components/HeaderMenuBar';
import { AppModals } from './components/AppModals';
import { Toolbar } from './components/Toolbar';
import { PanelView } from './components/PanelView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSettings } from './hooks/useSettings';
import { useSplitter } from './hooks/useSplitter';
import { usePanels } from './hooks/usePanels';
import { useCommandExecution } from './hooks/useCommandExecution';

const AppLockModal = React.lazy(() => import('./components/modals/AppLockModal').then(m => ({ default: m.AppLockModal })));
import { CommandLineBar } from './components/CommandLineBar';
import { FunctionKeyBar } from './components/FunctionKeyBar';
import { ContextMenu } from './components/ContextMenu';
import { HoverPreviewTooltip } from './components/HoverPreviewTooltip';
import { CollapsibleInfoDrawer } from './components/CollapsibleInfoDrawer';

// Modals
import { taskQueue } from './services/taskQueueManager';
import { log } from './utils/logger';

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
    purple: { cursor: '#a855f7', selected: '#581c87' }
  };
  const selectedSelectorPalette = fileSelectorPalette[settings.fileSelectorColor || 'blue'] || fileSelectorPalette.blue;
  const themeForFileList = { ...currentTheme, cursorBg: selectedSelectorPalette.cursor, selectedBg: selectedSelectorPalette.selected };
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
  const [drives, setDrives] = useState<Drive[]>(() => fsEngine.getDrives());
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');

  // Hover Tooltip state
  const [hoveredItem, setHoveredItem] = useState<FileItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  // Admin Mode state
  const [isAdminMode, setIsAdminMode] = useState(false);

  // Quick Search state (Type-to-jump)
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');
  const quickSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leftTreePaneRef = useRef<HTMLDivElement | null>(null);
  const leftTreeTabRef = useRef<HTMLButtonElement | null>(null);

  // Storage Onboarding State
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => false);

  // App Lock state
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => settings.appLockEnabled);

  // Password Unlock Flow state
  const [unlockTarget, setUnlockTarget] = useState<{
    side: 'left' | 'right';
    path: string;
    expectedPass: string;
  } | null>(null);



  // Active Modals & Operations
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [selectedFileForModal, setSelectedFileForModal] = useState<FileItem | null>(null);

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetItem: FileItem | null;
    panelSide: 'left' | 'right';
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetItem: null,
    panelSide: 'left'
  });

  // MS-DOS Command History
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);

  // Manual Panel Width Resizing State
  const { isDraggingSplitter, setIsDraggingSplitter } = useSplitter(setSettings);

  // Load real OS drives when a local drive API is available
  useEffect(() => {
    void fsEngine.loadRealDrivesFromApi();
  }, []);


  // Sync with FileSystem changes
  const [fsTick, setFsTick] = useState(0);

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
  });

  const { handleExecuteCommand } = useCommandExecution({
    lang,
    activeItems,
    currentActiveTab,
    activePanel,
    isAdminMode,
    setIsAdminMode,
    handleGoParent: activePanel === 'left' ? handleLeftGoParent : handleRightGoParent,
    handleNavigate: (side, path) => handleNavigate(side, path),
    setCommandHistory,
  });

  useEffect(() => {
    return fsEngine.subscribe(() => {
      setDrives(fsEngine.getDrives());
      setFsTick(t => t + 1);
    });
  }, []);


  // One-time migration: replace any legacy plaintext password with a salted
  // PBKDF2 hash so it is never persisted in clear.
  const passwordMigratedRef = useRef(false);
  useEffect(() => {
    if (passwordMigratedRef.current) return;
    passwordMigratedRef.current = true;
    if (settings.appPasswordHash && !settings.appPasswordSalt) {
      createPasswordRecord(settings.appPasswordHash)
        .then((record) =>
          setSettings((s) => ({ ...s, appPasswordHash: record.hash, appPasswordSalt: record.salt }))
        )
        .catch(() => {});
    }
  }, []);




  // Triggers
  const getSelectedOrFocusedItems = (): FileItem[] => {
    const selected = activeItems.filter(i => currentActiveTab.selectedIds.includes(i.id));
    if (selected.length > 0) return selected;
    if (activeFocusedItem) return [activeFocusedItem];
    return [];
  };

  const handleTriggerCopy = () => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    soundManager.playKeyTick();
    setModalData({ items, type: 'copy' });
    setActiveModal('copy');
  };

  const handleTriggerMove = () => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    soundManager.playKeyTick();
    setModalData({ items, type: 'move' });
    setActiveModal('move');
  };

  const handleTriggerDelete = () => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    soundManager.playKeyTick();
    setModalData({ items });
    setActiveModal('delete');
  };

  // Keyboard navigation engine
  useKeyboardShortcuts({
    activePanel,
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
  });

  const handleConfirmCopy = (targetPath: string, overwrite: boolean) => {
    const items: FileItem[] = modalData?.items || [];
    const totalBytes = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);

    const executor = async (onProgress: (transferred: number, total: number) => void, signal: { paused: boolean; cancelled: boolean }) => {
      let transferred = 0;
      for (const item of items) {
        if (signal.cancelled) return;
        while (signal.paused && !signal.cancelled) { /* wait */ }
        if (signal.cancelled) return;
        try {
          await fsEngine.copyItem(item.id, currentInactiveTab.driveId, targetPath, overwrite, (t, _total) => {
            transferred += t;
            onProgress(transferred, totalBytes);
          });
        } catch (e) {
          console.error('Copy failed for', item.name, e);
        }
      }
    };

    taskQueue.addTask('copy', t.appCopying.replace('{n}', String(items.length)), t.appDest.replace('{path}', targetPath), totalBytes, executor);
    setActiveModal(null);
  };

  const handleConfirmMove = (targetPath: string) => {
    const items: FileItem[] = modalData?.items || [];
    const totalBytes = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);

    const executor = async (onProgress: (transferred: number, total: number) => void, signal: { paused: boolean; cancelled: boolean }) => {
      let transferred = 0;
      for (const item of items) {
        if (signal.cancelled) return;
        while (signal.paused && !signal.cancelled) { /* wait */ }
        if (signal.cancelled) return;
        try {
          await fsEngine.moveItem(item.id, currentInactiveTab.driveId, targetPath, (t, _total) => {
            transferred += t;
            onProgress(transferred, totalBytes);
          });
        } catch (e) {
          console.error('Move failed for', item.name, e);
        }
      }
    };

    taskQueue.addTask('move', t.appMoving.replace('{n}', String(items.length)), t.appDest.replace('{path}', targetPath), totalBytes, executor);
    setActiveModal(null);
  };

  const handleConfirmDelete = () => {
    const items: FileItem[] = modalData?.items || [];
    const useTrash = settings.useRecycleBin !== false;
    taskQueue.addTask('delete', `${useTrash ? t.appSendingTrash : t.appDeleting} ${t.appItemsCount.replace('{n}', String(items.length))}`);

    items.forEach(item => {
      fsEngine.deleteItem(item.id, useTrash);
    });
    soundManager.playSuccess();
    setActiveModal(null);
  };

  const handleConfirmMkDir = (dirName: string) => {
    try {
      fsEngine.createDirectory(currentActiveTab.driveId, currentActiveTab.currentPath, dirName);
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleConfirmNewFile = (fileName: string) => {
    try {
      fsEngine.createFile(currentActiveTab.driveId, currentActiveTab.currentPath, fileName, '');
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleApplyBatchRename = (renames: { id: string; newName: string }[]) => {
    renames.forEach(r => {
      fsEngine.renameItem(r.id, r.newName);
    });
    setActiveModal(null);
  };

  const handleCompressZip = async (archiveName: string) => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    const totalBytes = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
    taskQueue.addTask('archive', t.appPacking.replace('{name}', archiveName), t.appItemsCount.replace('{n}', String(items.length)), totalBytes);
    await fsEngine.createZipArchive(items, archiveName, currentActiveTab.driveId, currentActiveTab.currentPath);
    setActiveModal(null);
  };

  const handleExtractZip = async (zipFile: FileItem) => {
    taskQueue.addTask('extract', t.appUnpacking.replace('{name}', `${zipFile.name}.${zipFile.ext}`), t.appDest.replace('{path}', currentActiveTab.currentPath), zipFile.size);
    await fsEngine.extractZipArchive(zipFile, currentActiveTab.driveId, currentActiveTab.currentPath);
    setActiveModal(null);
  };

  const handleDropItems = useCallback((
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation: 'copy' | 'move' = 'copy'
  ) => {
    soundManager.playDiskAccess();
    const totalBytes = draggedItems.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
    taskQueue.addTask(
      operation === 'move' ? 'move' : 'copy',
      (operation === 'move' ? t.appMovingDrag : t.appCopyingDrag).replace('{n}', String(draggedItems.length)),
      t.appDest.replace('{path}', targetPath),
      totalBytes
    );

    const movedIds = new Set(draggedItems.map(i => i.id));

    void (async () => {
      for (const item of draggedItems) {
        if (operation === 'move') {
          await fsEngine.moveItem(item.id, targetDriveId, targetPath);
        } else {
          const isSameDir = item.driveId === targetDriveId && item.path === targetPath;
          await fsEngine.copyItem(item.id, targetDriveId, targetPath, !isSameDir);
        }
      }

      if (operation === 'move') {
        setLeftPanel(p => ({
          ...p,
          tabs: p.tabs.map(t => ({
            ...t,
            selectedIds: t.selectedIds.filter(id => !movedIds.has(id))
          }))
        }));
        setRightPanel(p => ({
          ...p,
          tabs: p.tabs.map(t => ({
            ...t,
            selectedIds: t.selectedIds.filter(id => !movedIds.has(id))
          }))
        }));
      }
      soundManager.playSuccess();
      setFsTick(t => t + 1);
    })().catch(e => console.error('Drop operation failed', e));

    if (operation === 'move') {
      setLeftPanel(p => ({
        ...p,
        tabs: p.tabs.map(t => ({
          ...t,
          selectedIds: t.selectedIds.filter(id => !movedIds.has(id))
        }))
      }));
      setRightPanel(p => ({
        ...p,
        tabs: p.tabs.map(t => ({
          ...t,
          selectedIds: t.selectedIds.filter(id => !movedIds.has(id))
        }))
      }));
    }

    soundManager.playSuccess();
    setFsTick(t => t + 1);
  }, []);

  const handleDropNativeFiles = useCallback(async (
    files: globalThis.FileList,
    targetPath: string,
    targetDriveId: string
  ) => {
    soundManager.playDiskAccess();
    for (let i = 0; i < files.length; i++) {
      await fsEngine.importBrowserFile(files[i], targetDriveId, targetPath);
    }
    setFsTick(t => t + 1);
  }, []);

  const handleMountDrivePhysically = async (driveId: 'drive_c' | 'drive_d' | 'drive_host') => {
    // If running in a cross-origin iframe, showDirectoryPicker is disallowed by browser security
    if (typeof window !== 'undefined' && window.self !== window.top) {
      setShowOnboarding(true);
      return;
    }

    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        await fsEngine.mountLocalDirectory(handle, driveId);
        soundManager.playSuccess();
        setFsTick(t => t + 1);

        if (driveId === 'drive_c') {
          await handleSelectDrive('left', 'drive_c');
        } else if (driveId === 'drive_d') {
          await handleSelectDrive('right', 'drive_d');
        } else {
          await handleSelectDrive(activePanel, 'drive_host');
        }

        setShowOnboarding(false);
        localStorage.setItem('nc_onboarding_real_v1', 'true');
      } catch (err: any) {
        // User closed or cancelled the directory picker dialog
        if (err?.name === 'AbortError') {
          return;
        }
        // Browser sub-frame security policy restriction
        if (err?.name === 'SecurityError' || String(err).includes('Cross origin sub frames')) {
          return;
        }
        log.warn('Directory picker notification:', err);
      }
    }
  };

  const handleMountLocalPC = async () => {
    await handleMountDrivePhysically('drive_host');
  };

  // Password Folder Protection Handler
  const handleSetFolderPassword = (folderPath: string, password: string | null) => {
    setSettings(prev => {
      const updated = { ...(prev.protectedFolders || {}) };
      if (password) {
        updated[folderPath] = password;
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
      setLeftPanel(p => ({ ...p, isTreeVisible: false }));
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [leftPanel.isTreeVisible, isDraggingSplitter]);

  return (
    <div 
      className="flex flex-col h-screen w-screen overflow-hidden font-mono select-none relative"
      style={{
        backgroundColor: currentTheme.bgApp,
        color: currentTheme.itemText
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
      {/* App Lock Overlay if app lock active */}
      {isAppLocked && (
        <AppLockModal
          theme={currentTheme}
          lang={lang}
          expectedUser={settings.appUsername || 'admin'}
          expectedPassHash={settings.appPasswordHash || 'admin123'}
          expectedPassSalt={settings.appPasswordSalt}
          onUnlockSuccess={() => setIsAppLocked(false)}
        />
      )}

      {/* 1. Retro Pull-down Menu Bar */}
      <HeaderMenuBar
        theme={currentTheme}
        lang={lang}
        showClock={settings.showClock}
        clockPosition={settings.clockPosition}
        crtEffectEnabled={settings.crtEffectEnabled}
        onToggleCrt={() => setSettings(s => ({ ...s, crtEffectEnabled: !s.crtEffectEnabled }))}
        onOpenModal={(m) => {
          if (m === 'viewer' || m === 'editor' || m === 'checksum' || m === 'properties') {
            if (activeFocusedItem) setSelectedFileForModal(activeFocusedItem);
          }
          if (m === 'app_lock') {
            setIsAppLocked(true);
            return;
          }
          setActiveModal(m);
        }}
        onRefresh={() => {
          soundManager.playKeyTick();
          setFsTick(t => t + 1);
        }}
        onSelectAll={handleSelectAll}
        onInvertSelection={handleInvertSelection}
        onToggleQuickView={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setRightPanel : setLeftPanel;
          targetSet(p => ({ ...p, isQuickView: !p.isQuickView }));
        }}
        onToggleTree={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setLeftPanel : setRightPanel;
          targetSet(p => ({ ...p, isTreeVisible: !p.isTreeVisible }));
        }}
        onSwapPanels={handleSwapPanels}
        onNewTab={(side) => handleNewTab(side)}
        onChangeDrive={(side, dId) => handleSelectDrive(side, dId)}
        activePanel={activePanel}
        isQuickView={inactivePanelState.isQuickView}
        isTreeVisible={activePanelState.isTreeVisible}
        onSetTheme={(themeId: ThemeId) => setSettings(s => ({ ...s, theme: themeId }))}
        onSetLang={(newLang: LanguageCode) => setSettings(s => ({ ...s, language: newLang }))}
        onResetDefaults={() => {
          if (confirm(t.appResetConfirm)) {
            fsEngine.resetToDefaults();
          }
        }}
        onMinimizeWindow={() => {
          const api = (window as any).electronAPI;
          if (api?.minimizeWindow) api.minimizeWindow();
        }}
        onMaximizeWindow={() => {
          const api = (window as any).electronAPI;
          if (api?.maximizeWindow) api.maximizeWindow();
        }}
        onCloseWindow={() => {
          const api = (window as any).electronAPI;
          if (api?.closeWindow) api.closeWindow();
          else window.close();
        }}
      />

      <Toolbar
        currentTheme={currentTheme}
        t={t}
        showToolbar={settings.showToolbar}
        activePanel={activePanel}
        leftTab={leftTab}
        rightTab={rightTab}
        setLeftPanel={setLeftPanel}
        setRightPanel={setRightPanel}
        setFsTick={setFsTick}
        activeFocusedItem={activeFocusedItem}
        setSelectedFileForModal={setSelectedFileForModal}
        setActiveModal={setActiveModal}
      />

      {/* 2. Main Dual-Panel Viewport */}
      <div id="dual-panel-container" className="flex-1 flex flex-col md:flex-row min-h-0 relative p-1 gap-1">
        <PanelView
          side="left"
          widthPercent={settings.dualPaneRatio || 50}
          currentTheme={currentTheme}
          themeForFileList={themeForFileList}
          lang={lang}
          settings={settings}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          onRefresh={handleLeftRefresh}
          quickSearchQuery={quickSearchQuery}
          drives={drives}
          panel={leftPanel}
          setPanel={setLeftPanel}
          tab={leftTab}
          items={leftItems}
          otherItems={rightItems}
          otherTab={rightTab}
          drive={currentActiveDrive}
          isFilterOpen={isLeftFilterOpen}
          setIsFilterOpen={setIsLeftFilterOpen}
          treePaneRef={leftTreePaneRef}
          isTreeVisible={leftPanel.isTreeVisible}
          onToggleTree={() => setLeftPanel(p => ({ ...p, isTreeVisible: !p.isTreeVisible }))}
          onDropItems={handleDropItems}
          onDropNativeFiles={handleDropNativeFiles}
          onMountLocalPC={handleMountLocalPC}
          onOpenCloudManager={() => setActiveModal('cloud_manager')}
          onNavigate={(p) => handleNavigate('left', p)}
          onSelectDrive={(dId) => handleSelectDrive('left', dId)}
          onSelectTab={(tId) => handleSelectTab('left', tId)}
          onNewTab={() => handleNewTab('left')}
          onCloseTab={(tId) => handleCloseTab('left', tId)}
          onToggleLockTab={(tId) => handleToggleLockTab('left', tId)}
          onDuplicateTab={(tId) => handleDuplicateTab('left', tId)}
          onGoParent={handleLeftGoParent}
          onGoBack={() => handleGoBack('left')}
          onGoForward={() => handleGoForward('left')}
          onSort={handleLeftSort}
          onSelectIndex={handleLeftSelectIndex}
          onToggleSelect={handleLeftToggleSelect}
          onOpenItem={handleOpenItem}
          onContextMenu={handleLeftContextMenu}
          onItemHover={handleLeftItemHover}
        />

        {/* Interactive Resizable Divider Bar */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDraggingSplitter(true);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setIsDraggingSplitter(true);
          }}
          className="hidden md:flex w-2.5 hover:w-3.5 bg-black/40 hover:bg-amber-400/90 cursor-col-resize items-center justify-center transition-all group z-30 select-none rounded border border-white/10 hover:border-amber-300"
          title={t.appResizerTitle}
        >
          <div className="w-0.5 h-10 bg-amber-400/60 group-hover:bg-black rounded-full" />
        </div>

        <PanelView
          side="right"
          widthPercent={100 - (settings.dualPaneRatio || 50)}
          currentTheme={currentTheme}
          themeForFileList={themeForFileList}
          lang={lang}
          settings={settings}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          onRefresh={handleRightRefresh}
          quickSearchQuery={quickSearchQuery}
          drives={drives}
          panel={rightPanel}
          setPanel={setRightPanel}
          tab={rightTab}
          items={rightItems}
          otherItems={leftItems}
          otherTab={leftTab}
          drive={currentInactiveDrive}
          isFilterOpen={isRightFilterOpen}
          setIsFilterOpen={setIsRightFilterOpen}
          onDropItems={handleDropItems}
          onDropNativeFiles={handleDropNativeFiles}
          onMountLocalPC={handleMountLocalPC}
          onOpenCloudManager={() => setActiveModal('cloud_manager')}
          onNavigate={(p) => handleNavigate('right', p)}
          onSelectDrive={(dId) => handleSelectDrive('right', dId)}
          onSelectTab={(tId) => handleSelectTab('right', tId)}
          onNewTab={() => handleNewTab('right')}
          onCloseTab={(tId) => handleCloseTab('right', tId)}
          onToggleLockTab={(tId) => handleToggleLockTab('right', tId)}
          onDuplicateTab={(tId) => handleDuplicateTab('right', tId)}
          onGoParent={handleRightGoParent}
          onGoBack={() => handleGoBack('right')}
          onGoForward={() => handleGoForward('right')}
          onSort={handleRightSort}
          onSelectIndex={handleRightSelectIndex}
          onToggleSelect={handleRightToggleSelect}
          onOpenItem={handleOpenItem}
          onContextMenu={handleRightContextMenu}
          onItemHover={handleRightItemHover}
        />
      </div>

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
          isAdminMode={isAdminMode}
          onToggleAdminMode={() => setIsAdminMode(!isAdminMode)}
          onLockApp={() => setIsAppLocked(true)}
          isFolderProtected={!!(settings.protectedFolders && currentActiveTab?.currentPath && settings.protectedFolders[currentActiveTab.currentPath])}
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
          commandHistory={commandHistory}
          onClearHistory={() => setCommandHistory([])}
          isAdminMode={isAdminMode}
          onToggleAdminMode={() => setIsAdminMode(!isAdminMode)}
          availableItems={activeItems}
        />
      )}

      {/* 5. Bottom F1..F10 Function Key Bar */}
      {settings.showFunctionBar && (
        <FunctionKeyBar
          theme={currentTheme}
          lang={lang}
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
      {contextMenuState.visible && (
        <ContextMenu
          theme={currentTheme}
          lang={lang}
          x={contextMenuState.x}
          y={contextMenuState.y}
          targetItem={contextMenuState.targetItem}
          onClose={() => setContextMenuState(s => ({ ...s, visible: false }))}
          onView={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('viewer');
            }
          }}
          onEdit={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('editor');
            }
          }}
          onCopy={handleTriggerCopy}
          onMove={handleTriggerMove}
          onDelete={handleTriggerDelete}
          onMkDir={() => setActiveModal('mkdir')}
          onNewFile={() => {
            setModalData({ isNewFile: true });
            setActiveModal('new_file');
          }}
          onZip={() => setActiveModal('zipArchive')}
          onChecksum={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('checksum');
            }
          }}
          onProperties={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('properties');
            }
          }}
          onDownload={() => {
            const item = contextMenuState.targetItem;
            if (item) {
              const blob = new Blob([item.content || ''], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${item.name}.${item.ext || 'txt'}`;
              a.click();
              URL.revokeObjectURL(url);
            }
          }}
          onUpload={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                await fsEngine.importBrowserFile(file, currentActiveTab.driveId, currentActiveTab.currentPath);
                soundManager.playSuccess();
              }
            };
            input.click();
          }}
          onRefresh={() => setFsTick(t => t + 1)}
          onProtectFolder={() => {
            const target = contextMenuState.targetItem;
            if (target && target.isDirectory) {
              setModalData({ targetFolderPath: `${target.path}\\${target.name}` });
            } else {
              setModalData({ targetFolderPath: currentActiveTab.currentPath });
            }
            setActiveModal('protect_folder');
          }}
          onSplitFile={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('file_splitter');
            }
          }}
        />
      )}

      <AppModals
        currentTheme={currentTheme}
        lang={lang}
        selectedFileForModal={selectedFileForModal}
        setActiveModal={setActiveModal}
        activeModal={activeModal}
        modalData={modalData}
        setModalData={setModalData}
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
        showOnboarding={showOnboarding}
        setShowOnboarding={setShowOnboarding}
        handleConfirmCopy={handleConfirmCopy}
        handleConfirmMove={handleConfirmMove}
        handleConfirmDelete={handleConfirmDelete}
        handleConfirmMkDir={handleConfirmMkDir}
        handleConfirmNewFile={handleConfirmNewFile}
        handleApplyBatchRename={handleApplyBatchRename}
        getSelectedOrFocusedItems={getSelectedOrFocusedItems}
        handleNavigate={handleNavigate}
        handleSelectIndex={handleSelectIndex}
        handleCompressZip={handleCompressZip}
        handleExtractZip={handleExtractZip}
        handleMountLocalPC={handleMountLocalPC}
        handleSetFolderPassword={handleSetFolderPassword}
        handleSelectDrive={handleSelectDrive}
        handleExecuteCommand={handleExecuteCommand}
        handleMountDrivePhysically={handleMountDrivePhysically}
      />

      <button
        ref={leftTreeTabRef}
        onClick={() => setLeftPanel(p => ({ ...p, isTreeVisible: !p.isTreeVisible }))}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-[10000] w-6 h-14 rounded-r-md border border-l-0 text-[11px] font-bold flex items-center justify-center cursor-pointer shadow-lg"
        style={{ backgroundColor: currentTheme.headerBg, color: currentTheme.headerText, borderColor: currentTheme.borderPanel }}
        title={t.toggleTreeTooltip}
      >
        {leftPanel.isTreeVisible ? '◁' : '▷'}
      </button>
    </div>
  );
}
