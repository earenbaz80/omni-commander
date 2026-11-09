import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ArchivePasswordError } from '../services/archiveBackend';
import { fsEngine } from '../services/fileSystem';
import { soundManager } from '../services/soundEffects';
import {
  ActiveModal,
  Drive,
  FileItem,
  FolderPasswordRecord,
  PanelState,
  PanelTab,
  SortField,
  UserSettings,
} from '../types';
import { tGlobal } from '../i18n/translations';
import { ARCHIVE_EXTENSIONS } from '../services/archiveBackend';
import { matchesPanelFilter } from '../utils/panelFilter';

interface PanelDeps {
  drives: Drive[];
  settings: UserSettings;
  activePanel: 'left' | 'right';
  activeModal: ActiveModal;
  setActiveModal: React.Dispatch<React.SetStateAction<ActiveModal>>;
  setQuickSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  quickSearchTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setSelectedFileForModal: React.Dispatch<React.SetStateAction<FileItem | null>>;
  setUnlockTarget: React.Dispatch<
    React.SetStateAction<{ side: 'left' | 'right'; path: string; record: FolderPasswordRecord } | null>
  >;
  setHoveredItem: React.Dispatch<React.SetStateAction<FileItem | null>>;
  setHoverPos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  setContextMenuState: React.Dispatch<
    React.SetStateAction<{
      visible: boolean;
      x: number;
      y: number;
      targetItem: FileItem | null;
      panelSide: 'left' | 'right';
    }>
  >;
  fsTick: number;
  setFsTick: React.Dispatch<React.SetStateAction<number>>;
  requestArchivePassword?: (fileName: string, invalid?: boolean) => Promise<string | null>;
}

/**
 * Dual-pane state and behaviour: the two panels, their tabs, navigation,
 * selection, sorting and file operations. Extracted from App to keep the
 * component focused on layout.
 */
export function usePanels(deps: PanelDeps) {
  const {
    drives,
    settings,
    activePanel,
    activeModal,
    setActiveModal,
    setQuickSearchQuery,
    quickSearchTimerRef,
    setSelectedFileForModal,
    setUnlockTarget,
    setHoveredItem,
    setHoverPos,
    setContextMenuState,
    fsTick,
    setFsTick,
    requestArchivePassword,
  } = deps;

  // Left & Right Panels State
  const [leftPanel, setLeftPanel] = useState<PanelState>({
    id: 'left',
    activeTabId: 'tab_left_1',
    tabs: [
      {
        id: 'tab_left_1',
        title: '',
        driveId: '',
        currentPath: '',
        history: [''],
        historyIndex: 0,
        viewMode: 'full',
        sortField: 'name',
        sortDirection: 'asc',
        filterText: '',
        selectedIds: [],
        focusedIndex: 0,
      },
    ],
    isTreeVisible: false,
    isQuickView: false,
    panelView: 'files',
  });

  const [rightPanel, setRightPanel] = useState<PanelState>({
    id: 'right',
    activeTabId: 'tab_right_1',
    tabs: [
      {
        id: 'tab_right_1',
        title: '',
        driveId: '',
        currentPath: '',
        history: [''],
        historyIndex: 0,
        viewMode: 'full',
        sortField: 'name',
        sortDirection: 'asc',
        filterText: '',
        selectedIds: [],
        focusedIndex: 0,
      },
    ],
    isTreeVisible: false,
    isQuickView: false,
    panelView: 'files',
  });

  // Quick live filter bar states (Ctrl+F)
  const [isLeftFilterOpen, setIsLeftFilterOpen] = useState(false);
  const [isRightFilterOpen, setIsRightFilterOpen] = useState(false);
  // Swap Panels (Ctrl+U)
  const handleSwapPanels = () => {
    soundManager.playKeyTick();
    const tempLeftTabs = [...leftPanel.tabs];
    const tempLeftActive = leftPanel.activeTabId;

    setLeftPanel((prev) => ({
      ...prev,
      tabs: rightPanel.tabs.map((t) => ({ ...t, id: t.id.replace('right', 'left_swapped') })),
      activeTabId: rightPanel.activeTabId.replace('right', 'left_swapped'),
    }));

    setRightPanel((prev) => ({
      ...prev,
      tabs: tempLeftTabs.map((t) => ({ ...t, id: t.id.replace('left', 'right_swapped') })),
      activeTabId: tempLeftActive.replace('left', 'right_swapped'),
    }));
  };
  // Auto-open the first real detected drive in each panel instead of showing a mount onboarding.
  useEffect(() => {
    if (!drives.length) return;
    const firstDrive = drives[0];
    const hydrateEmptyDrive = (prev: PanelState) => {
      const hasRealDrive = prev.tabs.some((tab) => tab.driveId.startsWith('real_'));
      if (hasRealDrive) return prev;
      return {
        ...prev,
        tabs: prev.tabs.map((tab) =>
          tab.driveId === ''
            ? {
                ...tab,
                driveId: firstDrive.id,
                currentPath: firstDrive.letter,
                history: [firstDrive.letter],
                historyIndex: 0,
                selectedIds: [],
                focusedIndex: 0,
              }
            : tab,
        ),
      };
    };
    setLeftPanel(hydrateEmptyDrive);
    setRightPanel(hydrateEmptyDrive);
  }, [drives]);
  // Helper getters for active and inactive panels
  const activePanelState = activePanel === 'left' ? leftPanel : rightPanel;
  const inactivePanelState = activePanel === 'left' ? rightPanel : leftPanel;

  const currentActiveTab =
    activePanelState.tabs.find((t) => t.id === activePanelState.activeTabId) || activePanelState.tabs[0];
  const currentInactiveTab =
    inactivePanelState.tabs.find((t) => t.id === inactivePanelState.activeTabId) || inactivePanelState.tabs[0];

  const emptyDrive: Drive = {
    id: '',
    letter: '',
    name: tGlobal('panelNoRealDrives'),
    type: 'local',
    totalBytes: 0,
    freeBytes: 0,
    description: tGlobal('panelNoRealDrivesDesc'),
    isMounted: false,
  };
  const currentActiveDrive = drives.find((d) => d.id === currentActiveTab.driveId) || emptyDrive;
  const currentInactiveDrive = drives.find((d) => d.id === currentInactiveTab.driveId) || emptyDrive;

  // Retrieve files for active/inactive panels
  const getPanelItems = useCallback(
    (tab: PanelTab) => {
      let items = fsEngine.getFiles(tab.driveId, tab.currentPath);

      if (!settings.showHiddenFiles) {
        items = items.filter((i) => !i.attributes.hidden);
      }

      if (!settings.showSystemFiles) {
        items = items.filter((i) => !i.attributes.system);
      }

      if (tab.filterText.trim()) {
        // Wildcards, anchoring and the escaping of every other metacharacter live
        // in utils/panelFilter, which is tested without a hook around it.
        items = items.filter((item: FileItem) => matchesPanelFilter(item, tab.filterText));
      }

      return [...items].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;

        const valA = a[tab.sortField];
        const valB = b[tab.sortField];

        if (typeof valA === 'string' && typeof valB === 'string') {
          const cmp = valA.localeCompare(valB);
          return tab.sortDirection === 'asc' ? cmp : -cmp;
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return tab.sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        return 0;
      });
    },
    [settings.showHiddenFiles, settings.showSystemFiles],
  );

  const leftTab = leftPanel.tabs.find((t) => t.id === leftPanel.activeTabId) || leftPanel.tabs[0];
  const rightTab = rightPanel.tabs.find((t) => t.id === rightPanel.activeTabId) || rightPanel.tabs[0];

  const leftItems = useMemo(() => getPanelItems(leftTab), [getPanelItems, leftTab, fsTick]);
  const rightItems = useMemo(() => getPanelItems(rightTab), [getPanelItems, rightTab, fsTick]);

  const activeItems = activePanel === 'left' ? leftItems : rightItems;
  const activeFocusedItem = useMemo(
    () => activeItems[currentActiveTab.focusedIndex] || null,
    [activeItems, currentActiveTab.focusedIndex],
  );

  // Trigger host filesystem sync on navigation instead of during render/getFiles
  useEffect(() => {
    if (leftTab.driveId.startsWith('real_')) {
      void fsEngine.loadSystemDriveDirectory(leftTab.driveId, leftTab.currentPath);
    }
    if (rightTab.driveId.startsWith('real_')) {
      void fsEngine.loadSystemDriveDirectory(rightTab.driveId, rightTab.currentPath);
    }
  }, [leftTab.driveId, leftTab.currentPath, rightTab.driveId, rightTab.currentPath]);

  // Selected stats for CollapsibleInfoDrawer
  const activeSelectedItems = activeItems.filter((i) => currentActiveTab.selectedIds.includes(i.id));
  const activeSelectedBytes = activeSelectedItems.reduce((sum, item) => sum + item.size, 0);

  // Protected Folder Check
  const checkFolderPasswordProtection = useCallback(
    (panelSide: 'left' | 'right', targetPath: string): boolean => {
      const protectedMap = settings.protectedFolders || {};
      const record = protectedMap[targetPath];
      if (record) {
        setUnlockTarget({ side: panelSide, path: targetPath, record });
        setActiveModal('unlock_folder');
        return true; // Is protected and intercepted
      }
      return false; // Not protected
    },
    [settings.protectedFolders, setUnlockTarget, setActiveModal],
  );
  // Navigation & Path operations
  const handleNavigate = useCallback(
    (panelSide: 'left' | 'right', newPath: string) => {
      if (checkFolderPasswordProtection(panelSide, newPath)) {
        return;
      }

      // Detect if we're entering/leaving a virtual archive
      const targetPanel = panelSide === 'left' ? leftPanel : rightPanel;
      const activeTab = targetPanel.tabs.find((t) => t.id === targetPanel.activeTabId);
      const currentArchiveRoot = activeTab?.archiveRoot;

      // Check if newPath is inside an archive
      let newArchiveRoot: string | undefined;
      let newVirtualPath: string | undefined;

      if (currentArchiveRoot && newPath.startsWith(currentArchiveRoot + '\\')) {
        // Staying inside the same archive - update virtual path
        newArchiveRoot = currentArchiveRoot;
        newVirtualPath = newPath.slice(currentArchiveRoot.length + 1);
      } else if (!currentArchiveRoot) {
        // Check if new path is an archive root (from openArchive)
        const mount = fsEngine.getArchiveSource(activeTab?.driveId || '', newPath);
        if (mount) {
          // Entering an archive
          newArchiveRoot = newPath;
          newVirtualPath = '';
        }
      }
      // If we have currentArchiveRoot but newPath doesn't start with it, we're leaving the archive
      // newArchiveRoot and newVirtualPath remain undefined (clearing archive state)

      const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
      targetSet((p) => ({
        ...p,
        tabs: p.tabs.map((tab) => {
          if (tab.id !== p.activeTabId) return tab;
          const newHistory = [...tab.history.slice(0, tab.historyIndex + 1), newPath];
          return {
            ...tab,
            currentPath: newPath,
            history: newHistory,
            historyIndex: newHistory.length - 1,
            selectedIds: [],
            focusedIndex: 0,
            filterText: '',
            archiveRoot: newArchiveRoot ?? (newVirtualPath === undefined ? undefined : tab.archiveRoot),
            virtualPath: newVirtualPath ?? (newArchiveRoot === undefined ? undefined : tab.virtualPath),
          };
        }),
      }));
    },
    [checkFolderPasswordProtection, setLeftPanel, setRightPanel, leftPanel, rightPanel],
  );

  // Multi-Tab management
  const handleSelectTab = (panelSide: 'left' | 'right', tabId: string) => {
    if (panelSide === 'left') {
      setLeftPanel((p) => ({ ...p, activeTabId: tabId }));
    } else {
      setRightPanel((p) => ({ ...p, activeTabId: tabId }));
    }
  };

  const handleNewTab = (panelSide: 'left' | 'right') => {
    soundManager.playKeyTick();
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    const currentTab = panelSide === 'left' ? leftTab : rightTab;

    const newTab: PanelTab = {
      id: `tab_${panelSide}_${Date.now()}`,
      title: currentTab.currentPath,
      driveId: currentTab.driveId,
      currentPath: currentTab.currentPath,
      history: [currentTab.currentPath],
      historyIndex: 0,
      viewMode: currentTab.viewMode,
      sortField: 'name',
      sortDirection: 'asc',
      filterText: '',
      selectedIds: [],
      focusedIndex: 0,
      // Preserve archive navigation state
      archiveRoot: currentTab.archiveRoot,
      virtualPath: currentTab.virtualPath,
    };

    targetSet((p) => ({
      ...p,
      tabs: [...p.tabs, newTab],
      activeTabId: newTab.id,
    }));
  };

  const handleCloseTab = (panelSide: 'left' | 'right', tabId: string) => {
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => {
      if (p.tabs.length <= 1) return p;
      const filtered = p.tabs.filter((t) => t.id !== tabId);
      const newActive = p.activeTabId === tabId ? filtered[filtered.length - 1].id : p.activeTabId;
      return { ...p, tabs: filtered, activeTabId: newActive };
    });
  };

  const handleToggleLockTab = (panelSide: 'left' | 'right', tabId: string) => {
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => ({
      ...p,
      tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, isLocked: !t.isLocked } : t)),
    }));
  };

  const handleDuplicateTab = (panelSide: 'left' | 'right', tabId: string) => {
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    const currentTabs = panelSide === 'left' ? leftPanel.tabs : rightPanel.tabs;
    const srcTab = currentTabs.find((t) => t.id === tabId);
    if (!srcTab) return;

    const newTab: PanelTab = {
      ...srcTab,
      id: `tab_${panelSide}_${Date.now()}`,
      isLocked: false,
    };

    targetSet((p) => ({
      ...p,
      tabs: [...p.tabs, newTab],
      activeTabId: newTab.id,
    }));
  };

  const handleGoParent = useCallback(
    (panelSide: 'left' | 'right') => {
      const tab = panelSide === 'left' ? leftTab : rightTab;
      const parent = fsEngine.getParentPath(tab.currentPath);
      if (parent && parent !== tab.currentPath) {
        handleNavigate(panelSide, parent);
      }
    },
    [leftTab, rightTab, handleNavigate],
  );

  const handleRefresh = useCallback(
    async (panelSide: 'left' | 'right') => {
      const tab = panelSide === 'left' ? leftTab : rightTab;
      if (tab.driveId.startsWith('real_')) {
        await fsEngine.loadSystemDriveDirectory(tab.driveId, tab.currentPath);
      }
      setFsTick((t) => t + 1);
    },
    [leftTab, rightTab, setFsTick],
  );

  const handleLeftRefresh = useCallback(() => {
    void handleRefresh('left');
  }, [handleRefresh]);
  const handleRightRefresh = useCallback(() => {
    void handleRefresh('right');
  }, [handleRefresh]);

  /**
   * Moves one step through the panel's history.
   *
   * The destination is a path the user is entering, exactly like the ones
   * `handleNavigate` receives, so it asks for the password of a protected
   * folder on the way. Back and forward used to write `currentPath` straight
   * into the tab, which meant going back into a protected folder walked past
   * the prompt the same folder asks for when it is opened from the list.
   */
  const stepHistory = useCallback(
    (panelSide: 'left' | 'right', delta: 1 | -1) => {
      const tab = panelSide === 'left' ? leftTab : rightTab;
      const newIdx = tab.historyIndex + delta;
      if (newIdx < 0 || newIdx >= tab.history.length) return;
      const targetPath = tab.history[newIdx];
      if (checkFolderPasswordProtection(panelSide, targetPath)) return;

      const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
      targetSet((p) => ({
        ...p,
        tabs: p.tabs.map((current) => {
          if (current.id !== p.activeTabId) return current;
          return {
            ...current,
            currentPath: targetPath,
            historyIndex: newIdx,
            selectedIds: [],
            focusedIndex: 0,
          };
        }),
      }));
    },
    [leftTab, rightTab, checkFolderPasswordProtection, setLeftPanel, setRightPanel],
  );

  const handleGoBack = useCallback((panelSide: 'left' | 'right') => stepHistory(panelSide, -1), [stepHistory]);
  const handleGoForward = useCallback((panelSide: 'left' | 'right') => stepHistory(panelSide, 1), [stepHistory]);

  const handleSelectDrive = useCallback(
    async (panelSide: 'left' | 'right', driveId: string) => {
      const drive = drives.find((d) => d.id === driveId);
      if (!drive) return;

      const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
      targetSet((p) => ({
        ...p,
        tabs: p.tabs.map((tab) => {
          if (tab.id !== p.activeTabId) return tab;
          return {
            ...tab,
            driveId: drive.id,
            currentPath: drive.letter,
            history: [drive.letter],
            historyIndex: 0,
            selectedIds: [],
            focusedIndex: 0,
            filterText: '',
          };
        }),
      }));
      void fsEngine.loadSystemDriveDirectory(drive.id, drive.letter);
    },
    [drives],
  );

  const handleSort = useCallback((panelSide: 'left' | 'right', field: SortField) => {
    soundManager.playKeyTick();
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => ({
      ...p,
      tabs: p.tabs.map((tab) => {
        if (tab.id !== p.activeTabId) return tab;
        const isSame = tab.sortField === field;
        return {
          ...tab,
          sortField: field,
          sortDirection: isSame && tab.sortDirection === 'asc' ? 'desc' : 'asc',
        };
      }),
    }));
  }, []);

  const handleSelectIndex = useCallback((panelSide: 'left' | 'right', index: number) => {
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => ({
      ...p,
      tabs: p.tabs.map((tab) => (tab.id === p.activeTabId ? { ...tab, focusedIndex: index } : tab)),
    }));
  }, []);

  const handleToggleSelect = useCallback((panelSide: 'left' | 'right', id: string) => {
    const targetSet = panelSide === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => ({
      ...p,
      tabs: p.tabs.map((tab) => {
        if (tab.id !== p.activeTabId) return tab;
        const isSelected = tab.selectedIds.includes(id);
        const nextSelected = isSelected ? tab.selectedIds.filter((i) => i !== id) : [...tab.selectedIds, id];
        return { ...tab, selectedIds: nextSelected };
      }),
    }));
  }, []);

  const handleSelectAll = useCallback(() => {
    soundManager.playSelectSound();
    const targetSet = activePanel === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => ({
      ...p,
      tabs: p.tabs.map((tab) => {
        if (tab.id !== p.activeTabId) return tab;
        return { ...tab, selectedIds: activeItems.map((i) => i.id) };
      }),
    }));
  }, [activeItems]);

  const handleInvertSelection = useCallback(() => {
    soundManager.playSelectSound();
    const targetSet = activePanel === 'left' ? setLeftPanel : setRightPanel;
    targetSet((p) => ({
      ...p,
      tabs: p.tabs.map((tab) => {
        if (tab.id !== p.activeTabId) return tab;
        const inverted = activeItems.map((i) => i.id).filter((id) => !tab.selectedIds.includes(id));
        return { ...tab, selectedIds: inverted };
      }),
    }));
  }, [activeItems]);

  // Open item
  const handleOpenItem = useCallback(
    async (item: FileItem) => {
      try {
        if (item.isDirectory) {
          const newPath = `${item.path}\\${item.name}`;
          handleNavigate(activePanel, newPath);
        } else if (ARCHIVE_EXTENSIONS.includes(item.ext.toUpperCase()) && !item.archiveRoot) {
          let password: string | undefined;
          for (;;) {
            try {
              handleNavigate(activePanel, await fsEngine.openArchive(item, password));
              return;
            } catch (e) {
              // A password-protected archive is not damage, so ask for the
              // password. This covers an encrypted RAR or 7-Zip too: the server
              // decrypts with it. When none can be collected, say so instead of
              // closing silently as if nothing had been opened.
              if (e instanceof Error && e.name === 'ArchivePasswordError') {
                const next = requestArchivePassword
                  ? await requestArchivePassword(item.name, (e as ArchivePasswordError).reason === 'invalid')
                  : null;
                if (!next) {
                  alert(tGlobal('zipErrPasswordNeeded').replace('{name}', `${item.name}.${item.ext}`));
                  return;
                }
                password = next;
                continue;
              }
              // Anything else (an unreadable format, a corrupt file) surfaces
              // with its own message through the outer catch.
              throw e;
            }
          }
        } else {
          const content =
            item.archiveRoot || item.contentEncoding === 'base64'
              ? new TextDecoder().decode(await fsEngine.readFileBytes(item))
              : item.content;
          setSelectedFileForModal({ ...item, content });
          setActiveModal('viewer');
        }
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      }
    },
    [activePanel, handleNavigate],
  );

  // Reset quick search on active panel, path, or modal change
  useEffect(() => {
    setQuickSearchQuery('');
    if (quickSearchTimerRef.current) clearTimeout(quickSearchTimerRef.current);
  }, [activePanel, currentActiveTab.currentPath, activeModal]);

  // Stable per-panel handlers used by memoized FileList instances
  const handleLeftGoParent = useCallback(() => handleGoParent('left'), [handleGoParent]);
  const handleRightGoParent = useCallback(() => handleGoParent('right'), [handleGoParent]);
  const handleLeftSort = useCallback((field: SortField) => handleSort('left', field), [handleSort]);
  const handleRightSort = useCallback((field: SortField) => handleSort('right', field), [handleSort]);
  const handleLeftSelectIndex = useCallback((index: number) => handleSelectIndex('left', index), [handleSelectIndex]);
  const handleRightSelectIndex = useCallback((index: number) => handleSelectIndex('right', index), [handleSelectIndex]);
  const handleLeftToggleSelect = useCallback((id: string) => handleToggleSelect('left', id), [handleToggleSelect]);
  const handleRightToggleSelect = useCallback((id: string) => handleToggleSelect('right', id), [handleToggleSelect]);
  const handleLeftContextMenu = useCallback((e: React.MouseEvent, item: FileItem | null) => {
    e.preventDefault();
    setContextMenuState({ visible: true, x: e.clientX, y: e.clientY, targetItem: item, panelSide: 'left' });
  }, []);
  const handleRightContextMenu = useCallback((e: React.MouseEvent, item: FileItem | null) => {
    e.preventDefault();
    setContextMenuState({ visible: true, x: e.clientX, y: e.clientY, targetItem: item, panelSide: 'right' });
  }, []);
  const handleLeftItemHover = useCallback((e: React.MouseEvent, item: FileItem | null) => {
    setHoveredItem(item);
    if (item) setHoverPos({ x: e.clientX, y: e.clientY });
  }, []);
  const handleRightItemHover = useCallback((e: React.MouseEvent, item: FileItem | null) => {
    setHoveredItem(item);
    if (item) setHoverPos({ x: e.clientX, y: e.clientY });
  }, []);

  return {
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
  };
}
