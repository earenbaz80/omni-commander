import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { useKeyboardShortcuts, KeyboardShortcutDeps } from './useKeyboardShortcuts';
import type { FileItem, PanelTab } from '../types';

/**
 * The other half of the keyboard map. `useKeyboardShortcuts.test.tsx` pins the
 * two paths that broke in production (the size tree swallowing keys and the
 * drive cycle with no drives); this one walks the rest of the map: the F-keys,
 * the Ctrl combinations, row navigation and the type-to-jump search.
 */

const tab = (overrides: Partial<PanelTab> = {}): PanelTab =>
  ({
    id: 'tab1',
    title: 'T',
    driveId: 'real_C',
    currentPath: 'C:\\datos',
    history: [],
    historyIndex: 0,
    viewMode: 'full',
    sortField: 'name',
    sortDirection: 'asc',
    filterText: '',
    selectedIds: [],
    focusedIndex: 1,
    ...overrides,
  }) as PanelTab;

const items: FileItem[] = [
  { id: 'f1', name: 'alpha.txt', isDirectory: false, size: 10 },
  { id: 'f2', name: 'beta.txt', isDirectory: false, size: 20 },
  { id: 'f3', name: 'gamma', isDirectory: true, size: 0 },
] as FileItem[];

type Mocks = Record<
  | 'setActivePanel'
  | 'setActiveModal'
  | 'setSelectedFileForModal'
  | 'setQuickSearchQuery'
  | 'setLeftPanel'
  | 'setRightPanel'
  | 'setIsLeftFilterOpen'
  | 'setIsRightFilterOpen'
  | 'handleTriggerCopy'
  | 'handleTriggerMove'
  | 'handleTriggerDelete'
  | 'handleClipboardCopy'
  | 'handleClipboardCut'
  | 'handleClipboardPaste'
  | 'handleNewTab'
  | 'handleCloseTab'
  | 'handleSelectAll'
  | 'handleSwapPanels'
  | 'handleSelectIndex'
  | 'handleToggleSelect'
  | 'handleOpenItem'
  | 'handleGoParent'
  | 'handleOpenRunLauncher',
  ReturnType<typeof vi.fn>
>;

function harness(deps: Partial<KeyboardShortcutDeps> = {}) {
  const mocks: Mocks = {
    setActivePanel: vi.fn(),
    setActiveModal: vi.fn(),
    setSelectedFileForModal: vi.fn(),
    setQuickSearchQuery: vi.fn(),
    setLeftPanel: vi.fn(),
    setRightPanel: vi.fn(),
    setIsLeftFilterOpen: vi.fn(),
    setIsRightFilterOpen: vi.fn(),
    handleTriggerCopy: vi.fn(),
    handleTriggerMove: vi.fn(),
    handleTriggerDelete: vi.fn(),
    handleClipboardCopy: vi.fn(),
    handleClipboardCut: vi.fn(),
    handleClipboardPaste: vi.fn(),
    handleNewTab: vi.fn(),
    handleCloseTab: vi.fn(),
    handleSelectAll: vi.fn(),
    handleSwapPanels: vi.fn(),
    handleSelectIndex: vi.fn(),
    handleToggleSelect: vi.fn(),
    handleOpenItem: vi.fn(),
    handleGoParent: vi.fn(),
    handleOpenRunLauncher: vi.fn(),
  };
  const timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null> = { current: null };
  const handleSelectDrive = vi.fn(async () => {});

  renderHook(() =>
    useKeyboardShortcuts({
      activePanel: 'left',
      activePanelShowsDiskUsage: false,
      currentActiveTab: tab(),
      activeItems: items,
      activeFocusedItem: items[0],
      activeModal: null,
      isAppLocked: false,
      drives: [],
      leftTab: tab(),
      rightTab: tab(),
      quickSearchQuery: '',
      quickSearchTimerRef: timerRef,
      handleSelectDrive,
      ...mocks,
      ...deps,
      // A mock accepts anything; the dependency object wants the real signatures,
      // and every one of them is present by the time this object is built.
    } as unknown as KeyboardShortcutDeps),
  );

  return { mocks, timerRef, handleSelectDrive };
}

function press(key: string, options: { alt?: boolean; ctrl?: boolean; shift?: boolean; target?: EventTarget } = {}) {
  const target = options.target ?? window;
  const event = new KeyboardEvent('keydown', {
    key,
    altKey: !!options.alt,
    ctrlKey: !!options.ctrl,
    shiftKey: !!options.shift,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useKeyboardShortcuts F-keys', () => {
  it('opens the viewer for the focused entry and does nothing without one', () => {
    const focused = harness();
    press('F3');
    expect(focused.mocks.setSelectedFileForModal).toHaveBeenCalledWith(items[0]);
    expect(focused.mocks.setActiveModal).toHaveBeenCalledWith('viewer');

    cleanup();
    const empty = harness({ activeFocusedItem: null });
    press('F3');
    expect(empty.mocks.setActiveModal).not.toHaveBeenCalled();
  });

  it('opens the editor for a file but never for a folder', () => {
    const file = harness();
    press('F4');
    expect(file.mocks.setActiveModal).toHaveBeenCalledWith('editor');

    cleanup();
    const folder = harness({ activeFocusedItem: items[2] });
    press('F4');
    expect(folder.mocks.setActiveModal).not.toHaveBeenCalled();
  });

  it('reaches create-folder, delete, move and quit', () => {
    const { mocks } = harness();

    press('F7');
    expect(mocks.setActiveModal).toHaveBeenCalledWith('mkdir');

    press('F10');
    expect(mocks.setActiveModal).toHaveBeenCalledWith('quit');

    press('F6');
    expect(mocks.handleTriggerMove).toHaveBeenCalled();

    press('F8');
    expect(mocks.handleTriggerDelete).toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts Ctrl combinations', () => {
  it('opens and closes tabs on the active panel', () => {
    const { mocks } = harness();

    press('t', { ctrl: true });
    expect(mocks.handleNewTab).toHaveBeenCalledWith('left');

    press('w', { ctrl: true });
    expect(mocks.handleCloseTab).toHaveBeenCalledWith('left', 'tab1');
  });

  it('selects everything, swaps the panels and toggles the quick view of the other one', () => {
    const { mocks } = harness();

    press('a', { ctrl: true });
    expect(mocks.handleSelectAll).toHaveBeenCalled();

    press('u', { ctrl: true });
    expect(mocks.handleSwapPanels).toHaveBeenCalled();

    press('q', { ctrl: true });
    const toggle = mocks.setRightPanel.mock.calls[0][0] as (p: { isQuickView: boolean }) => { isQuickView: boolean };
    expect(toggle({ isQuickView: false })).toEqual({ isQuickView: true });
  });

  it('opens the rename, bookmarks and checksum dialogs', () => {
    const { mocks } = harness();

    press('m', { ctrl: true });
    expect(mocks.setActiveModal).toHaveBeenCalledWith('batch_rename');

    press('d', { ctrl: true });
    expect(mocks.setActiveModal).toHaveBeenCalledWith('hotlist_bookmarks');

    press('h', { ctrl: true });
    expect(mocks.setSelectedFileForModal).toHaveBeenCalledWith(items[0]);
    expect(mocks.setActiveModal).toHaveBeenCalledWith('checksum');
  });

  it('opens the filter of whichever panel is active', () => {
    const left = harness();
    press('f', { ctrl: true });
    expect(left.mocks.setIsLeftFilterOpen).toHaveBeenCalled();
    expect(left.mocks.setIsRightFilterOpen).not.toHaveBeenCalled();

    cleanup();
    const right = harness({ activePanel: 'right' });
    press('f', { ctrl: true });
    expect(right.mocks.setIsRightFilterOpen).toHaveBeenCalled();
    expect(right.mocks.setIsLeftFilterOpen).not.toHaveBeenCalled();
  });

  it('copies, cuts and pastes the selection through the app clipboard', () => {
    const { mocks } = harness();

    press('c', { ctrl: true });
    expect(mocks.handleClipboardCopy).toHaveBeenCalledTimes(1);

    press('x', { ctrl: true });
    expect(mocks.handleClipboardCut).toHaveBeenCalledTimes(1);

    press('v', { ctrl: true });
    expect(mocks.handleClipboardPaste).toHaveBeenCalledTimes(1);

    // They belong to the clipboard, not to the transfer dialogs the F-keys open.
    expect(mocks.handleTriggerCopy).not.toHaveBeenCalled();
    expect(mocks.handleTriggerMove).not.toHaveBeenCalled();
    expect(mocks.setActiveModal).not.toHaveBeenCalled();
  });

  it('switches panels with tab', () => {
    const { mocks } = harness();

    press('Tab');

    const flip = mocks.setActivePanel.mock.calls[0][0] as (p: 'left' | 'right') => 'left' | 'right';
    expect(flip('left')).toBe('right');
    expect(flip('right')).toBe('left');
  });
});

describe('useKeyboardShortcuts row navigation', () => {
  it('moves one row at a time and stays inside the list', () => {
    const { mocks } = harness();

    press('ArrowUp');
    expect(mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 0);

    press('ArrowDown');
    expect(mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 2);

    cleanup();
    const atEnd = harness({ currentActiveTab: tab({ focusedIndex: 2 }) });
    press('ArrowDown');
    expect(atEnd.mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 2);
  });

  it('jumps with home, end and the page keys', () => {
    const { mocks } = harness();

    press('Home');
    expect(mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 0);

    press('End');
    expect(mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 2);

    press('PageUp');
    expect(mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 0);

    press('PageDown');
    expect(mocks.handleSelectIndex).toHaveBeenLastCalledWith('left', 2);
  });
});

describe('useKeyboardShortcuts type-to-jump', () => {
  it('builds the search and jumps to the first name that matches', () => {
    vi.useFakeTimers();
    const { mocks, timerRef } = harness();

    press('b');

    expect(mocks.setQuickSearchQuery).toHaveBeenCalledWith('b');
    expect(mocks.handleSelectIndex).toHaveBeenCalledWith('left', 1);
    expect(timerRef.current).not.toBeNull();

    // The query is dropped on its own so the next key starts a new search.
    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(mocks.setQuickSearchQuery).toHaveBeenLastCalledWith('');
  });

  it('shortens the query with backspace and falls back to the parent when it is empty', () => {
    const searching = harness({ quickSearchQuery: 'ga' });

    press('Backspace');
    expect(searching.mocks.setQuickSearchQuery).toHaveBeenCalledWith('g');
    expect(searching.mocks.handleGoParent).not.toHaveBeenCalled();

    cleanup();
    const empty = harness();
    press('Backspace');
    expect(empty.mocks.handleGoParent).toHaveBeenCalledWith('left');
  });

  it('clears the search and opens the focused entry with enter', () => {
    const { mocks } = harness({ quickSearchQuery: 'ga' });

    press('Enter');

    expect(mocks.setQuickSearchQuery).toHaveBeenCalledWith('');
    expect(mocks.handleOpenItem).toHaveBeenCalledWith(items[0]);
  });

  it('clears the search with escape before it closes a dialog', () => {
    const searching = harness({ quickSearchQuery: 'ga' });
    press('Escape');
    expect(searching.mocks.setQuickSearchQuery).toHaveBeenCalledWith('');

    cleanup();
    const withDialog = harness({ activeModal: 'help' });
    press('Escape');
    expect(withDialog.mocks.setActiveModal).toHaveBeenCalledWith(null);
  });
});

describe('useKeyboardShortcuts selection', () => {
  it('toggles the focused entry with space or insert and moves on', () => {
    const space = harness();
    press(' ');
    expect(space.mocks.handleToggleSelect).toHaveBeenCalledWith('left', 'f1');
    expect(space.mocks.handleSelectIndex).toHaveBeenCalledWith('left', 2);

    cleanup();
    const insert = harness();
    press('Insert');
    expect(insert.mocks.handleToggleSelect).toHaveBeenCalledWith('left', 'f1');
  });
});

describe('useKeyboardShortcuts inside a field', () => {
  it('lets the field keep its keys', () => {
    const { mocks } = harness();
    const field = document.createElement('input');
    document.body.appendChild(field);

    press('F5', { target: field });
    press('Delete', { target: field });
    press('a', { target: field });
    press('c', { ctrl: true, target: field });
    press('v', { ctrl: true, target: field });

    expect(mocks.handleTriggerCopy).not.toHaveBeenCalled();
    expect(mocks.handleTriggerDelete).not.toHaveBeenCalled();
    expect(mocks.handleSelectAll).not.toHaveBeenCalled();
    expect(mocks.setQuickSearchQuery).not.toHaveBeenCalled();
    // The field keeps its own clipboard: no file is snapped up while typing.
    expect(mocks.handleClipboardCopy).not.toHaveBeenCalled();
    expect(mocks.handleClipboardPaste).not.toHaveBeenCalled();

    field.remove();
  });
});
