import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useKeyboardShortcuts, KeyboardShortcutDeps } from './useKeyboardShortcuts';
import { Drive, PanelTab } from '../types';

/**
 * Alt+F1 / Alt+F2 cycle drives. Two things have to hold, and both were broken:
 *  - a plain-F1/F2 branch used to swallow the Alt+ variant, so the drive-cycle
 *    path was unreachable;
 *  - with an empty drive list (`initialDrives` is `[]`, so a fresh install hits
 *    this before the first successful poll) the modulo was `% 0` -> NaN, and
 *    `drives[NaN].id` threw a TypeError inside the window keydown handler.
 *
 * A DOM listener that throws does not propagate out of `dispatchEvent`; jsdom
 * routes it to the window `error` event, which is the channel this test reads.
 */

const tab = (driveId: string): PanelTab => ({
  id: 'tab1',
  title: 'T',
  driveId,
  currentPath: 'T:\\',
  history: [],
  historyIndex: 0,
  viewMode: 'full',
  sortField: 'name',
  sortDirection: 'asc',
  filterText: '',
  selectedIds: [],
  focusedIndex: 0,
});

const drive = (id: string, letter: string): Drive => ({
  id,
  letter,
  name: letter,
  type: 'local',
  totalBytes: 1,
  freeBytes: 1,
  isMounted: true,
});

function renderKeyboardHook(deps: Partial<KeyboardShortcutDeps>) {
  const handleSelectDrive = vi.fn(async () => {});
  const setActiveModal = vi.fn();
  const handleTriggerCopy = vi.fn();
  const handleTriggerDelete = vi.fn();
  const handleSelectIndex = vi.fn();
  const setQuickSearchQuery = vi.fn();
  const handleOpenRunLauncher = vi.fn();
  const view = renderHook(() =>
    useKeyboardShortcuts({
      activePanel: 'left',
      activePanelShowsDiskUsage: false,
      currentActiveTab: tab(''),
      activeItems: [],
      activeFocusedItem: null,
      activeModal: null,
      isAppLocked: false,
      drives: [],
      leftTab: tab(''),
      rightTab: tab(''),
      quickSearchQuery: '',
      quickSearchTimerRef: { current: null },
      setActivePanel: vi.fn(),
      setActiveModal,
      setSelectedFileForModal: vi.fn(),
      setQuickSearchQuery,
      setLeftPanel: vi.fn(),
      setRightPanel: vi.fn(),
      setIsLeftFilterOpen: vi.fn(),
      setIsRightFilterOpen: vi.fn(),
      handleTriggerCopy,
      handleTriggerMove: vi.fn(),
      handleTriggerDelete,
      handleSelectDrive,
      handleNewTab: vi.fn(),
      handleCloseTab: vi.fn(),
      handleSelectAll: vi.fn(),
      handleSwapPanels: vi.fn(),
      handleSelectIndex,
      handleToggleSelect: vi.fn(),
      handleOpenItem: vi.fn(),
      handleGoParent: vi.fn(),
      handleOpenRunLauncher,
      ...deps,
    }),
  );
  return {
    view,
    handleSelectDrive,
    setActiveModal,
    handleTriggerCopy,
    handleTriggerDelete,
    handleSelectIndex,
    setQuickSearchQuery,
    handleOpenRunLauncher,
  };
}

/** Dispatches a keydown and returns any uncaught listener errors it produced. */
function press(key: string, altKey: boolean, ctrlKey = false, shiftKey = false): unknown[] {
  const uncaught: unknown[] = [];
  const onError = (event: ErrorEvent) => uncaught.push(event.error ?? event.message);
  window.addEventListener('error', onError);
  try {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey, ctrlKey, shiftKey }));
    });
  } finally {
    window.removeEventListener('error', onError);
  }
  return uncaught;
}

afterEach(() => {
  cleanup();
});

describe('useKeyboardShortcuts while a panel shows the size tree', () => {
  it('does not let Delete, F5, arrows or typing reach the hidden file list', () => {
    const { handleTriggerDelete, handleTriggerCopy, handleSelectIndex, setQuickSearchQuery } = renderKeyboardHook({
      activePanelShowsDiskUsage: true,
      activeItems: [{ id: 'f1', name: 'informe.txt', isDirectory: false, size: 10 } as never],
    });

    expect(press('Delete', false)).toEqual([]);
    press('F5', false);
    press('F8', false);
    press('F6', false);
    press('ArrowDown', false);
    press('a', false);
    press('a', false, true);

    expect(handleTriggerDelete).not.toHaveBeenCalled();
    expect(handleTriggerCopy).not.toHaveBeenCalled();
    expect(handleSelectIndex).not.toHaveBeenCalled();
    expect(setQuickSearchQuery).not.toHaveBeenCalled();
  });

  it('still runs the app-wide shortcuts and the alt drive cycle', () => {
    const { handleSelectDrive, setActiveModal } = renderKeyboardHook({
      activePanelShowsDiskUsage: true,
      drives: [drive('real_A', 'A:'), drive('real_B', 'B:')],
      rightTab: tab('real_A'),
    });

    press('F1', false);
    expect(setActiveModal).toHaveBeenCalledWith('help');

    press('F2', true);
    expect(handleSelectDrive).toHaveBeenCalledWith('right', 'real_B');
  });

  it('keeps those keys working when the panel shows its files', () => {
    const { handleTriggerDelete, handleTriggerCopy, handleSelectIndex } = renderKeyboardHook({
      activePanelShowsDiskUsage: false,
      activeItems: [{ id: 'f1', name: 'informe.txt', isDirectory: false, size: 10 } as never],
    });

    press('Delete', false);
    press('F5', false);
    press('ArrowDown', false);

    expect(handleTriggerDelete).toHaveBeenCalledTimes(1);
    expect(handleTriggerCopy).toHaveBeenCalledTimes(1);
    expect(handleSelectIndex).toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts Run launcher shortcut', () => {
  it('Ctrl+Shift+R opens the launcher, while Ctrl+R alone does not', () => {
    const { handleOpenRunLauncher } = renderKeyboardHook({});

    press('r', false, true);
    expect(handleOpenRunLauncher).not.toHaveBeenCalled();

    expect(press('R', false, true, true)).toEqual([]);
    expect(handleOpenRunLauncher).toHaveBeenCalledTimes(1);

    // A second press is a second request: the box can reopen after a close.
    press('r', false, true, true);
    expect(handleOpenRunLauncher).toHaveBeenCalledTimes(2);
  });

  it('opens even while the active panel shows the size tree', () => {
    const { handleOpenRunLauncher } = renderKeyboardHook({ activePanelShowsDiskUsage: true });

    press('r', false, true, true);

    expect(handleOpenRunLauncher).toHaveBeenCalledTimes(1);
  });

  it('answers from inside a text field and cancels the browser reload it would trigger', () => {
    const { handleOpenRunLauncher } = renderKeyboardHook({});
    const field = document.createElement('input');
    document.body.appendChild(field);

    const event = new KeyboardEvent('keydown', {
      key: 'R',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      field.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(handleOpenRunLauncher).toHaveBeenCalledTimes(1);
    field.remove();
  });

  it('stays out of the way while a dialog is open', () => {
    const { handleOpenRunLauncher } = renderKeyboardHook({ activeModal: 'help' });

    press('r', false, true, true);

    expect(handleOpenRunLauncher).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts drive cycling with zero drives', () => {
  it('Alt+F1 and Alt+F2 are clean no-ops instead of a NaN drive lookup', () => {
    const { handleSelectDrive, setActiveModal } = renderKeyboardHook({ drives: [] });

    const f1Errors = press('F1', true);
    const f2Errors = press('F2', true);

    // No `drives[NaN].id` TypeError reached the window keydown handler.
    expect(f1Errors).toEqual([]);
    expect(f2Errors).toEqual([]);
    // The Alt+ variants must not fall back to the plain F-key actions.
    expect(setActiveModal).not.toHaveBeenCalled();
    // With no drives there is nothing to select.
    expect(handleSelectDrive).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts drive cycling with drives present', () => {
  it('Alt+F1 and Alt+F2 advance to the next drive without opening a modal', () => {
    const drives = [drive('real_A', 'A:'), drive('real_B', 'B:')];
    const { handleSelectDrive, setActiveModal } = renderKeyboardHook({
      drives,
      leftTab: tab('real_A'),
      rightTab: tab('real_A'),
    });

    expect(press('F1', true)).toEqual([]);
    expect(press('F2', true)).toEqual([]);

    expect(handleSelectDrive).toHaveBeenCalledWith('left', 'real_B');
    expect(handleSelectDrive).toHaveBeenCalledWith('right', 'real_B');
    expect(setActiveModal).not.toHaveBeenCalled();
  });
});
