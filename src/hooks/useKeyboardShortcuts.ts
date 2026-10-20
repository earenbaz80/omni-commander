import { useEffect, useRef } from 'react';
import { soundManager } from '../services/soundEffects';
import { ActiveModal, Drive, FileItem, PanelState, PanelTab } from '../types';

export interface KeyboardShortcutDeps {
  activePanel: 'left' | 'right';
  currentActiveTab: PanelTab;
  activeItems: FileItem[];
  activeFocusedItem: FileItem | null;
  activeModal: ActiveModal;
  isAppLocked: boolean;
  drives: Drive[];
  leftTab: PanelTab;
  rightTab: PanelTab;
  quickSearchQuery: string;
  quickSearchTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setActivePanel: React.Dispatch<React.SetStateAction<'left' | 'right'>>;
  setActiveModal: React.Dispatch<React.SetStateAction<ActiveModal>>;
  setSelectedFileForModal: React.Dispatch<React.SetStateAction<FileItem | null>>;
  setQuickSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setLeftPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  setRightPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  setIsLeftFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRightFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleTriggerCopy: () => void;
  handleTriggerMove: () => void;
  handleTriggerDelete: () => void;
  handleSelectDrive: (panelSide: 'left' | 'right', driveId: string) => Promise<void>;
  handleNewTab: (panelSide: 'left' | 'right') => void;
  handleCloseTab: (panelSide: 'left' | 'right', tabId: string) => void;
  handleSelectAll: () => void;
  handleSwapPanels: () => void;
  handleSelectIndex: (panelSide: 'left' | 'right', index: number) => void;
  handleToggleSelect: (panelSide: 'left' | 'right', id: string) => void;
  handleOpenItem: (item: FileItem) => void;
  handleGoParent: (panelSide: 'left' | 'right') => void;
}

/**
 * Global keyboard engine (F-keys, Ctrl combos, navigation, type-to-jump search).
 * Extracted from App to keep the component focused.
 */
export function useKeyboardShortcuts(d: KeyboardShortcutDeps) {
  // The listener is attached once, but it must always act on the props of the
  // current render. Reading them through a ref keeps the effect stable without
  // relisting all 25 dependencies or capturing a stale closure.
  const dRef = useRef(d);
  dRef.current = d;

  // Keyboard navigation engine
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const {
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
      } = dRef.current;

      const targetTag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || activeModal || isAppLocked) {
        if (e.key === 'Escape') {
          if (quickSearchQuery) {
            setQuickSearchQuery('');
            if (quickSearchTimerRef.current) clearTimeout(quickSearchTimerRef.current);
          } else if (activeModal) {
            setActiveModal(null);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        if (quickSearchQuery) {
          e.preventDefault();
          setQuickSearchQuery('');
          if (quickSearchTimerRef.current) clearTimeout(quickSearchTimerRef.current);
          return;
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        soundManager.playKeyTick();
        setActivePanel(p => p === 'left' ? 'right' : 'left');
        return;
      }

      if (e.key === 'F1' && !e.altKey) {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('help');
        return;
      }
      if (e.key === 'F2' && !e.altKey) {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('user_menu');
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (activeFocusedItem) {
          soundManager.playKeyTick();
          setSelectedFileForModal(activeFocusedItem);
          setActiveModal('viewer');
        }
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (activeFocusedItem && !activeFocusedItem.isDirectory) {
          soundManager.playKeyTick();
          setSelectedFileForModal(activeFocusedItem);
          setActiveModal('editor');
        }
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        handleTriggerCopy();
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        handleTriggerMove();
        return;
      }
      if (e.key === 'F7' && !e.altKey) {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('mkdir');
        return;
      }
      if (e.key === 'F8' || e.key === 'Delete') {
        e.preventDefault();
        handleTriggerDelete();
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('quit');
        return;
      }

      if (e.altKey && e.key === 'F1') {
        e.preventDefault();
        // A fresh install starts with no drives; `% drives.length` would be
        // `% 0` (NaN) and index into nothing. Cycling drives is a no-op then.
        if (!drives.length) return;
        const nextDriveIdx = (drives.findIndex(d => d.id === leftTab.driveId) + 1) % drives.length;
        handleSelectDrive('left', drives[nextDriveIdx].id);
        return;
      }
      if (e.altKey && e.key === 'F2') {
        e.preventDefault();
        if (!drives.length) return;
        const nextDriveIdx = (drives.findIndex(d => d.id === rightTab.driveId) + 1) % drives.length;
        handleSelectDrive('right', drives[nextDriveIdx].id);
        return;
      }

      if (e.altKey && e.key === 'F7') {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('search_grep');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab(activePanel);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        handleCloseTab(activePanel, currentActiveTab.id);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        soundManager.playKeyTick();
        const targetSet = activePanel === 'left' ? setRightPanel : setLeftPanel;
        targetSet(p => ({ ...p, isQuickView: !p.isQuickView }));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('batch_rename');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('hotlist_bookmarks');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        handleSwapPanels();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        soundManager.playKeyTick();
        if (activePanel === 'left') {
          setIsLeftFilterOpen(prev => !prev);
        } else {
          setIsRightFilterOpen(prev => !prev);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (activeFocusedItem) {
          setSelectedFileForModal(activeFocusedItem);
          setActiveModal('checksum');
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        soundManager.playKeyTick();
        const next = Math.max(0, currentActiveTab.focusedIndex - 1);
        handleSelectIndex(activePanel, next);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        soundManager.playKeyTick();
        const next = Math.min(activeItems.length - 1, currentActiveTab.focusedIndex + 1);
        handleSelectIndex(activePanel, next);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        soundManager.playKeyTick();
        handleSelectIndex(activePanel, 0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        soundManager.playKeyTick();
        handleSelectIndex(activePanel, Math.max(0, activeItems.length - 1));
        return;
      }
      if (e.key === 'PageUp') {
        e.preventDefault();
        soundManager.playKeyTick();
        handleSelectIndex(activePanel, Math.max(0, currentActiveTab.focusedIndex - 12));
        return;
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        soundManager.playKeyTick();
        handleSelectIndex(activePanel, Math.min(activeItems.length - 1, currentActiveTab.focusedIndex + 12));
        return;
      }

      // Single character printable keys for Quick Search (Type-to-Jump)
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === ' ' && !quickSearchQuery) {
          // Fall through to space/insert selection below
        } else {
          e.preventDefault();
          const newQuery = quickSearchQuery + e.key;
          setQuickSearchQuery(newQuery);
          if (quickSearchTimerRef.current) clearTimeout(quickSearchTimerRef.current);
          quickSearchTimerRef.current = setTimeout(() => {
            setQuickSearchQuery('');
          }, 1800);

          let foundIndex = activeItems.findIndex(item =>
            item.name.toLowerCase().startsWith(newQuery.toLowerCase())
          );
          if (foundIndex === -1) {
            foundIndex = activeItems.findIndex(item =>
              item.name.toLowerCase().includes(newQuery.toLowerCase())
            );
          }
          if (foundIndex !== -1) {
            handleSelectIndex(activePanel, foundIndex);
            soundManager.playKeyTick();
          }
          return;
        }
      }

      if (e.key === ' ' || e.key === 'Insert') {
        e.preventDefault();
        if (activeFocusedItem) {
          soundManager.playSelectSound();
          handleToggleSelect(activePanel, activeFocusedItem.id);
          const next = Math.min(activeItems.length - 1, currentActiveTab.focusedIndex + 1);
          handleSelectIndex(activePanel, next);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (quickSearchQuery) {
          setQuickSearchQuery('');
          if (quickSearchTimerRef.current) clearTimeout(quickSearchTimerRef.current);
        }
        if (activeFocusedItem) {
          soundManager.playDiskAccess();
          handleOpenItem(activeFocusedItem);
        }
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        if (quickSearchQuery) {
          const newQuery = quickSearchQuery.slice(0, -1);
          setQuickSearchQuery(newQuery);
          if (quickSearchTimerRef.current) clearTimeout(quickSearchTimerRef.current);
          if (newQuery) {
            quickSearchTimerRef.current = setTimeout(() => setQuickSearchQuery(''), 1800);
            let foundIndex = activeItems.findIndex(item =>
              item.name.toLowerCase().startsWith(newQuery.toLowerCase())
            );
            if (foundIndex === -1) {
              foundIndex = activeItems.findIndex(item =>
                item.name.toLowerCase().includes(newQuery.toLowerCase())
              );
            }
            if (foundIndex !== -1) {
              handleSelectIndex(activePanel, foundIndex);
            }
          }
          return;
        }
        soundManager.playDiskAccess();
        handleGoParent(activePanel);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
