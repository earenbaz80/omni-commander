import { useEffect, useRef } from 'react';
import { soundManager } from '../services/soundEffects';
import { ActiveModal, Drive, FileItem, PanelState, PanelTab } from '../types';

/**
 * Keys that act on the file list of the active panel: opening, copying, moving,
 * deleting, filtering, selecting, walking the rows and type-to-jump.
 *
 * Alt combinations belong to navigation (drive cycling, the search dialog) and
 * the app-wide keys (F1, F2, F10, Tab, Ctrl+D, Ctrl+U) are deliberately absent,
 * so they keep working while a panel shows something other than its files.
 */
function isFileListShortcut(e: KeyboardEvent): boolean {
  if (e.altKey) return false;
  if (
    [
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'Delete',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Insert',
      'Enter',
      'Backspace',
      ' ',
    ].includes(e.key)
  ) {
    return true;
  }
  const command = e.ctrlKey || e.metaKey;
  if (command) return ['a', 'c', 'f', 'h', 'm', 'q', 't', 'v', 'w', 'x'].includes(e.key.toLowerCase());
  // A printable character starts the type-to-jump search.
  return e.key.length === 1;
}

export interface KeyboardShortcutDeps {
  activePanel: 'left' | 'right';
  /** True while the active panel body is the folder-size tree, not its files. */
  activePanelShowsDiskUsage: boolean;
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
  /** Ctrl+C: snapshots the selection into the app's own clipboard. */
  handleClipboardCopy: () => void;
  /** Ctrl+X: the same snapshot, marked to be moved on paste. */
  handleClipboardCut: () => void;
  /** Ctrl+V: transfers the clipboard into the folder of the active panel. */
  handleClipboardPaste: () => void;
  handleSelectDrive: (panelSide: 'left' | 'right', driveId: string) => Promise<void>;
  handleNewTab: (panelSide: 'left' | 'right') => void;
  handleCloseTab: (panelSide: 'left' | 'right', tabId: string) => void;
  handleSelectAll: () => void;
  handleSwapPanels: () => void;
  handleSelectIndex: (panelSide: 'left' | 'right', index: number) => void;
  handleToggleSelect: (panelSide: 'left' | 'right', id: string) => void;
  handleOpenItem: (item: FileItem) => void;
  handleGoParent: (panelSide: 'left' | 'right') => void;
  /** Opens the toolbar's Run launcher from anywhere in the window. */
  handleOpenRunLauncher: () => void;
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
        activePanelShowsDiskUsage,
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
        handleOpenRunLauncher,
      } = dRef.current;

      // The launcher's own key, answered before the text-field bail: it is a Ctrl
      // combination rather than typing, and browsers answer it with a hard
      // reload, so letting it through would reload the window instead of opening
      // the box. Shift is part of the combination, so Ctrl+R stays untouched.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (activeModal || isAppLocked) return;
        soundManager.playKeyTick();
        handleOpenRunLauncher();
        return;
      }

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
        setActivePanel((p) => (p === 'left' ? 'right' : 'left'));
        return;
      }

      // A panel showing the folder-size tree has no file list on screen. Its tab
      // still exists behind the tree, so Delete, F5 or type-to-jump would act on
      // a selection the user cannot see: they would delete or copy something
      // invisible. Swallow those keys here; the app-wide ones keep working so
      // help, the drive cycle and switching panels are never blocked.
      if (activePanelShowsDiskUsage && isFileListShortcut(e)) {
        // Consumed, not just ignored: otherwise F5 reloads the page and F3 or
        // Backspace trigger the browser's own find and history navigation.
        e.preventDefault();
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
        const nextDriveIdx = (drives.findIndex((d) => d.id === leftTab.driveId) + 1) % drives.length;
        handleSelectDrive('left', drives[nextDriveIdx].id);
        return;
      }
      if (e.altKey && e.key === 'F2') {
        e.preventDefault();
        if (!drives.length) return;
        const nextDriveIdx = (drives.findIndex((d) => d.id === rightTab.driveId) + 1) % drives.length;
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
      // The shell as a window. The backtick is the key DOS boxes used for their
      // own console, and no other combination in this map claims it.
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        soundManager.playKeyTick();
        setActiveModal('terminal');
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
        targetSet((p) => ({ ...p, isQuickView: !p.isQuickView }));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Copy, cut and paste as Windows spells them. Only the file list gets
      // here: a field or a modal returned early, so their own clipboard keeps
      // working, and the size tree swallowed these keys above.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleClipboardCopy();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleClipboardCut();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handleClipboardPaste();
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
          setIsLeftFilterOpen((prev) => !prev);
        } else {
          setIsRightFilterOpen((prev) => !prev);
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

          let foundIndex = activeItems.findIndex((item) => item.name.toLowerCase().startsWith(newQuery.toLowerCase()));
          if (foundIndex === -1) {
            foundIndex = activeItems.findIndex((item) => item.name.toLowerCase().includes(newQuery.toLowerCase()));
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
            let foundIndex = activeItems.findIndex((item) =>
              item.name.toLowerCase().startsWith(newQuery.toLowerCase()),
            );
            if (foundIndex === -1) {
              foundIndex = activeItems.findIndex((item) => item.name.toLowerCase().includes(newQuery.toLowerCase()));
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
