import { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem, CommandHistoryItem, FolderPasswordRecord, LanguageCode } from './types';
import { CleanupTargetId, fsEngine } from './services/fileSystem';
import { themes, ThemeConfig } from './services/themeManager';
import { createPasswordRecord } from './services/appLock';
import { setCurrentLang } from './i18n/translations';

// Components
import { AppModalLayer } from './components/AppModalLayer';
import { DualPaneView } from './components/DualPaneView';
import { WindowChrome } from './components/WindowChrome';
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
import { useFileOperations } from './hooks/useFileOperations';

import { CommandLineBar } from './components/CommandLineBar';
import { FunctionKeyBar } from './components/FunctionKeyBar';
import { FileContextMenu, type FileContextMenuState } from './components/FileContextMenu';
import { HoverPreviewTooltip } from './components/HoverPreviewTooltip';
import { CollapsibleInfoDrawer } from './components/CollapsibleInfoDrawer';

// Modals
import { startTrayBridge } from './services/trayBridge';
import { soundManager } from './services/soundEffects';

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

  // The selection as it was when Ctrl+C or Ctrl+X was pressed. A snapshot, not
  // a live read: navigating away or re-selecting before Ctrl+V must not change
  // what gets pasted.
  const [fileClipboard, setFileClipboard] = useState<{ items: FileItem[]; op: 'copy' | 'move' } | null>(null);

  const handleClipboardCopy = () => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    soundManager.playKeyTick();
    setFileClipboard({ items, op: 'copy' });
  };

  const handleClipboardCut = () => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    soundManager.playKeyTick();
    setFileClipboard({ items, op: 'move' });
  };

  // The transfer queue has to exist first: pasting is the same queued transfer
  // the copy window starts, only with the folder of the active panel as target.
  const transferQueue = useTransferQueue({
    lang,
    transferItems,
    currentActiveTab,
    currentInactiveTab,
    setFsTick,
  });

  const handleClipboardPaste = () => {
    if (!fileClipboard || fileClipboard.items.length === 0) return;
    soundManager.playDiskAccess();
    void transferQueue.handlePasteTransfer(
      fileClipboard.op,
      currentActiveTab.driveId,
      currentActiveTab.currentPath,
      fileClipboard.items,
    );
    // A cut is spent once it is pasted; a copy stays, as in Explorer.
    if (fileClipboard.op === 'move') setFileClipboard(null);
  };

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
    handleClipboardCopy,
    handleClipboardCut,
    handleClipboardPaste,
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

  const fileOperations = useFileOperations({
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
  });

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
      <WindowChrome
        theme={currentTheme}
        lang={lang}
        settings={settings}
        setSettings={setSettings}
        activePanel={activePanel}
        activePanelState={activePanelState}
        inactivePanelState={inactivePanelState}
        setLeftPanel={setLeftPanel}
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        leftTab={leftTab}
        rightTab={rightTab}
        activeFocusedItem={activeFocusedItem}
        setSelectedFileForModal={setSelectedFileForModal}
        setActiveModal={setActiveModal}
        setCleanupTarget={setCleanupTarget}
        setFsTick={setFsTick}
        isAppLocked={isAppLocked}
        lockApp={lockApp}
        unlockApp={unlockApp}
        onSelectAll={handleSelectAll}
        onInvertSelection={handleInvertSelection}
        onSwapPanels={handleSwapPanels}
        onNewTab={handleNewTab}
        onSelectDrive={handleSelectDrive}
        onNavigate={handleNavigate}
        runLauncherOpenRequest={runLauncherOpenRequest}
        launcherOnly={launcherOnly}
        setLauncherOnly={setLauncherOnly}
        stackedPanels={stackedPanels}
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
          dropItems: fileOperations.handleDropItems,
          dropNativeFiles: fileOperations.handleDropNativeFiles,
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

      <AppModalLayer
        ui={{ theme: currentTheme, lang, settings, setSettings }}
        panels={{
          activePanel,
          activeItems,
          activeFocusedItem,
          currentActiveTab,
          currentInactiveTab,
          leftTab,
          rightTab,
          leftItems,
          rightItems,
          drives,
          setLeftPanel,
          setRightPanel,
          setFsTick,
          selection: getSelectedOrFocusedItems,
        }}
        modal={{
          activeModal,
          setActiveModal,
          modalData,
          setModalData,
          selectedFileForModal,
          unlockTarget,
          setUnlockTarget,
          cleanupTarget,
        }}
        transfers={{ items: transferItems, queue: transferQueue, passwordRequest, submitPassword: settlePassword }}
        files={fileOperations}
        commands={{ navigate: handleNavigate, selectIndex: handleSelectIndex, executeCommand: handleExecuteCommand }}
        treeHandle={{
          visible: leftPanel.isTreeVisible,
          onToggle: () => setLeftPanel((p) => ({ ...p, isTreeVisible: !p.isTreeVisible })),
          buttonRef: leftTreeTabRef,
        }}
      />
    </div>
  );
}
