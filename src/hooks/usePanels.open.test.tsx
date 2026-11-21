import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePanels } from './usePanels';
import type { FileItem, UserSettings } from '../types';

/**
 * Enter and double click share `handleOpenItem`, and it used to end every file
 * that was not a folder or an archive in the viewer. An executable decoded as
 * text is only noise, so the program was never started and the editor was shown
 * instead. These two cases pin the split: a real executable goes to the shell's
 * default action, and a text file keeps the viewer it had.
 */
const { openRunTarget, absolutePathOf, isRealFile, readFileBytes } = vi.hoisted(() => ({
  openRunTarget: vi.fn(async () => ({ kind: 'opened' as const, target: 'C:\\Descargas\\setup.exe' })),
  absolutePathOf: vi.fn(() => 'C:\\Descargas\\setup.exe'),
  isRealFile: vi.fn(() => true),
  readFileBytes: vi.fn(async () => new Uint8Array()),
}));

vi.mock('../services/runLauncher', () => ({ openRunTarget }));
vi.mock('../services/fileSystem', () => ({
  fsEngine: {
    isRealFile,
    absolutePathOf,
    readFileBytes,
    getFiles: () => [],
    getDrive: () => undefined,
    normalizePath: (path: string) => path,
    childAbsolutePath: (parent: string, name: string) => `${parent}\\${name}`,
  },
}));

const makeDeps = () => ({
  drives: [],
  settings: { protectedFolders: {} } as unknown as UserSettings,
  activePanel: 'left' as const,
  activeModal: null,
  setActiveModal: vi.fn(),
  setQuickSearchQuery: vi.fn(),
  quickSearchTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
  setSelectedFileForModal: vi.fn(),
  setUnlockTarget: vi.fn(),
  setHoveredItem: vi.fn(),
  setHoverPos: vi.fn(),
  setContextMenuState: vi.fn(),
  fsTick: 0,
  setFsTick: vi.fn(),
});

const item = (name: string, ext: string, content = ''): FileItem =>
  ({
    id: `${name}.${ext}`,
    name,
    fullName: `${name}.${ext}`,
    ext,
    path: 'C:\\Descargas',
    driveId: 'real_C',
    isDirectory: false,
    size: 1024,
    content,
  }) as unknown as FileItem;

const open = async (target: FileItem) => {
  const deps = makeDeps();
  const { result } = renderHook(() => usePanels(deps));
  await act(async () => {
    await result.current.handleOpenItem(target);
  });
  return deps;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePanels openItem', () => {
  it('runs an executable on a real drive instead of loading it into the viewer', async () => {
    const deps = await open(item('setup', 'exe'));

    expect(openRunTarget).toHaveBeenCalledWith('C:\\Descargas\\setup.exe');
    expect(readFileBytes).not.toHaveBeenCalled();
    expect(deps.setSelectedFileForModal).not.toHaveBeenCalled();
    expect(deps.setActiveModal).not.toHaveBeenCalled();
  });

  it('still opens a text file in the viewer', async () => {
    const deps = await open(item('notas', 'txt', 'hola'));

    expect(openRunTarget).not.toHaveBeenCalled();
    expect(deps.setSelectedFileForModal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'notas', content: 'hola' }),
    );
    expect(deps.setActiveModal).toHaveBeenCalledWith('viewer');
  });
});
