import { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem, CommandHistoryItem, FolderPasswordRecord, LanguageCode, TransferPlan } from './types';
import { CleanupTargetId, fsEngine } from './services/fileSystem';
import { themes, ThemeConfig } from './services/themeManager';
import { createPasswordRecord } from './services/appLock';
import { getTranslations, setCurrentLang } from './i18n/translations';
import { describeElevationFailure } from './services/elevation';
import type { ElevationResult } from './types/electronBridge';

// Components
import { AppModalLayer } from './components/AppModalLayer';
import { DualPaneView } from './components/DualPaneView';
import { buildFileListTheme } from './services/fileListTheme';
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
  const themeForFileList = buildFileListTheme(currentTheme, settings);
  const lang: LanguageCode = settings.language;
  const t = getTranslations(lang);

  // Keep the module-level language store in sync for non-React consumers
  // (fsEngine, appLock, usePanels, ErrorBoundary, DriveBar). Set during render so
  // components rendered in this same pass already see the updated language.
  setCurrentLang(lang);

  // Keep the document language in sync for accessibility and search engines.
  // index.html ships lang="es"; without this the attribute would stay Spanish
  // no matter which language the user selects.
  // Danger and warning ink is part of the palette: the dialogs ask for these two
  // variables instead of naming a rose, a red or an amber, so switching theme
  // repaints every failure and every caution in one go.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.style.setProperty('--nc-danger', currentTheme.accentDanger);
    document.documentElement.style.setProperty('--nc-warn', currentTheme.accentWarn);
    document.documentElement.style.setProperty('--nc-ok', currentTheme.accentOk);
  }

  // File system state
  const drives = useDrives();
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');
  // The browser is a single native view owned by the main process: it is either
  // a window of its own or the content of one pane, never both at once.
  const [panelBrowser, setPanelBrowser] = useState<{ side: 'left' | 'right'; url: string } | null>(null);

  // Hover Tooltip state
  const [hoveredItem, setHoveredItem] = useState<FileItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  // Real elevation and the one way to change it (an elevated relaunch).
  const { isElevated, requestElevation: requestElevatedRestart } = useElevation();
  // A refused UAC leaves this window running, so the reason cannot stay inside
  // the IPC answer: the info drawer and the shell only ask, they have nowhere
  // to print it. One notice here covers both.
  const [elevationFailure, setElevationFailure] = useState<ElevationResult | null>(null);
  const requestElevation = useCallback(async () => {
    setElevationFailure(null);
    const result = await requestElevatedRestart();
    if (result && !result.ok) setElevationFailure(result);
  }, [requestElevatedRestart]);

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
  // Single-pane mode keeps one side on screen at a time. Tab still switches the
  // active panel, which is also what decides which side is the visible one.
  const singlePane = settings.splitLayout === 'single';

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

  // The tray mirrors the live transfer and turns its menu picks into the same
  // pause/resume/cancel the in-window bar calls, plus a repeat of the last stopped
  // one. The ref keeps the queue callback current without re-subscribing the menu
  // on every render; restarting on a language change only relabels it.
  const repeatFromTray = useRef<(plan: TransferPlan) => void>(() => {});
  repeatFromTray.current = (plan) => {
    void transferQueue.handleRunCopyList([plan]);
  };
  useEffect(() => startTrayBridge(lang, (plan) => repeatFromTray.current(plan)), [lang]);

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
      // The tree opens folders in whichever panel has the focus, so working in
      // either pane must not dismiss it. Otherwise clicking into the right pane
      // closes the tree before a folder can be chosen for it, which is exactly
      // the situation the tree is meant to serve.
      if (target instanceof Element && target.closest('[data-panel-side]')) return;
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
      {elevationFailure && (
        <div
          role="alert"
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[90] max-w-[min(92vw,620px)] flex items-start gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded border border-amber-400 bg-amber-950/95 text-amber-200 shadow-xl text-xs font-mono"
        >
          <span className="flex-1">{describeElevationFailure(elevationFailure, t)}</span>
          <button
            type="button"
            onClick={() => setElevationFailure(null)}
            aria-label={t.btnClose}
            title={t.btnClose}
            className="shrink-0 font-bold text-amber-300 hover:text-white cursor-pointer"
          >
            ×
          </button>
        </div>
      )}
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
        setActiveModal={(next) => {
          setPanelBrowser(null);
          setActiveModal(next);
        }}
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
        onOpenBrowserInPanel={() => {
          setActiveModal(null);
          setPanelBrowser({ side: activePanel, url: '' });
        }}
        runLauncherOpenRequest={runLauncherOpenRequest}
        launcherOnly={launcherOnly}
        setLauncherOnly={setLauncherOnly}
        stackedPanels={stackedPanels}
        singlePane={singlePane}
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
        single={singlePane}
        ratio={dualPaneRatio}
        dragging={isDraggingSplitter}
        onDragStart={() => setIsDraggingSplitter(true)}
        handlers={{
          navigate: handleNavigate,
          selectDrive: handleSelectDrive,
          // The tree is a sidebar: whatever folder is chosen there opens in the
          // panel that has the focus, not in the one the tree happens to sit in.
          navigateTree: (path) => handleNavigate(activePanel, path),
          selectDriveTree: (driveId) => void handleSelectDrive(activePanel, driveId),
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
          browserUrl: panelBrowser?.side === 'left' ? panelBrowser.url : undefined,
          onCloseBrowser: () => setPanelBrowser(null),
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
          browserUrl: panelBrowser?.side === 'right' ? panelBrowser.url : undefined,
          onCloseBrowser: () => setPanelBrowser(null),
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
        onExtract={(target, destination) => void fileOperations.handleExtractZip(target, destination)}
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
        commands={{
          navigate: handleNavigate,
          selectIndex: handleSelectIndex,
          executeCommand: handleExecuteCommand,
          history: commandHistory,
          clearHistory: () => setCommandHistory([]),
          isAdminMode: isElevated,
          requestElevation,
        }}
        treeHandle={{
          visible: leftPanel.isTreeVisible,
          onToggle: () => setLeftPanel((p) => ({ ...p, isTreeVisible: !p.isTreeVisible })),
          buttonRef: leftTreeTabRef,
        }}
      />
    </div>
  );
}
