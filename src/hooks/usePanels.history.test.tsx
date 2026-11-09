import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePanels } from './usePanels';
import type { FolderPasswordRecord, UserSettings } from '../types';

/**
 * Back and forward are entrances too.
 *
 * The history buttons used to write `currentPath` into the tab themselves, so a
 * folder with a password asked for it when opened from the list and let the
 * back button in for free. These tests pin the rule at both ends: a step into a
 * protected folder is intercepted and asks for the password, and the same step
 * still moves when the folder is not protected.
 */
const SECRET = 'C:\\Secret';
const SUB = 'C:\\Secret\\Sub';
const OTHER = 'C:\\Other';
const NESTED = 'C:\\Other\\Nested';

const record: FolderPasswordRecord = { salt: 'c2FsdA==', hash: 'aGFzaA==' };

const settingsWith = (protectedFolders: Record<string, FolderPasswordRecord>) =>
  ({ protectedFolders }) as unknown as UserSettings;

const makeDeps = (protectedFolders: Record<string, FolderPasswordRecord> = {}) => ({
  drives: [],
  settings: settingsWith(protectedFolders),
  activePanel: 'left' as const,
  activeModal: null,
  setActiveModal: vi.fn(),
  setQuickSearchQuery: vi.fn(),
  quickSearchTimerRef: { current: null },
  setSelectedFileForModal: vi.fn(),
  setUnlockTarget: vi.fn(),
  setHoveredItem: vi.fn(),
  setHoverPos: vi.fn(),
  setContextMenuState: vi.fn(),
  fsTick: 0,
  setFsTick: vi.fn(),
});

/**
 * One harness whose setters keep their identity across rerenders, so asserting
 * on them after a rerender still reads what the hook actually called.
 */
const withHistory = (paths: string[]) => {
  const deps = makeDeps();
  const { result, rerender } = renderHook((props: ReturnType<typeof makeDeps>) => usePanels(props), {
    initialProps: deps,
  });
  for (const path of paths) act(() => result.current.handleNavigate('left', path));

  const protect = (folders: Record<string, FolderPasswordRecord>) =>
    rerender({ ...deps, settings: settingsWith(folders) });

  return { result, protect, deps };
};

describe('usePanels history', () => {
  it('asks for the password before going back into a protected folder', () => {
    const { result, protect, deps } = withHistory([SECRET, SUB]);
    expect(result.current.currentActiveTab.currentPath).toBe(SUB);

    protect({ [SECRET]: record });
    act(() => result.current.handleGoBack('left'));

    expect(result.current.currentActiveTab.currentPath).toBe(SUB);
    expect(result.current.currentActiveTab.historyIndex).toBe(2);
    expect(deps.setUnlockTarget).toHaveBeenCalledWith({ side: 'left', path: SECRET, record });
    expect(deps.setActiveModal).toHaveBeenCalledWith('unlock_folder');
  });

  it('asks for the password before going forward into a protected folder', () => {
    const { result, protect, deps } = withHistory([OTHER, NESTED]);
    act(() => result.current.handleGoBack('left'));
    expect(result.current.currentActiveTab.currentPath).toBe(OTHER);

    protect({ [NESTED]: record });
    act(() => result.current.handleGoForward('left'));

    expect(result.current.currentActiveTab.currentPath).toBe(OTHER);
    expect(deps.setUnlockTarget).toHaveBeenCalledWith({ side: 'left', path: NESTED, record });
  });

  it('still steps when the folder is not protected', () => {
    const { result, deps } = withHistory([SECRET, SUB]);

    act(() => result.current.handleGoBack('left'));
    expect(result.current.currentActiveTab.currentPath).toBe(SECRET);
    expect(result.current.currentActiveTab.historyIndex).toBe(1);
    expect(deps.setUnlockTarget).not.toHaveBeenCalled();

    act(() => result.current.handleGoForward('left'));
    expect(result.current.currentActiveTab.currentPath).toBe(SUB);
    expect(result.current.currentActiveTab.historyIndex).toBe(2);
  });

  it('does not step past either end of the history', () => {
    const { result } = withHistory([SECRET]);

    act(() => result.current.handleGoBack('left'));
    act(() => result.current.handleGoBack('left'));
    expect(result.current.currentActiveTab.currentPath).toBe('');

    act(() => result.current.handleGoForward('left'));
    act(() => result.current.handleGoForward('left'));
    expect(result.current.currentActiveTab.currentPath).toBe(SECRET);
  });
});
