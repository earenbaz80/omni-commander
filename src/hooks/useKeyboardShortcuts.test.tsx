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
  const view = renderHook(() =>
    useKeyboardShortcuts({
      activePanel: 'left',
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
      setQuickSearchQuery: vi.fn(),
      setLeftPanel: vi.fn(),
      setRightPanel: vi.fn(),
      setIsLeftFilterOpen: vi.fn(),
      setIsRightFilterOpen: vi.fn(),
      handleTriggerCopy: vi.fn(),
      handleTriggerMove: vi.fn(),
      handleTriggerDelete: vi.fn(),
      handleSelectDrive,
      handleNewTab: vi.fn(),
      handleCloseTab: vi.fn(),
      handleSelectAll: vi.fn(),
      handleSwapPanels: vi.fn(),
      handleSelectIndex: vi.fn(),
      handleToggleSelect: vi.fn(),
      handleOpenItem: vi.fn(),
      handleGoParent: vi.fn(),
      ...deps,
    }),
  );
  return { view, handleSelectDrive, setActiveModal };
}

/** Dispatches a keydown and returns any uncaught listener errors it produced. */
function press(key: string, altKey: boolean): unknown[] {
  const uncaught: unknown[] = [];
  const onError = (event: ErrorEvent) => uncaught.push(event.error ?? event.message);
  window.addEventListener('error', onError);
  try {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey }));
    });
  } finally {
    window.removeEventListener('error', onError);
  }
  return uncaught;
}

afterEach(() => {
  cleanup();
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
