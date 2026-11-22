import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanels } from './usePanels';
import { getTranslations, setCurrentLang } from '../i18n/translations';
import { setPlatformInfo } from '../services/platform';
import type { FileItem, UserSettings } from '../types';

/**
 * Enter and double click share `handleOpenItem`, and it used to end every file
 * that was not a folder or an archive in the viewer. A file whose shell action
 * is to run something decoded as text is only noise, so the program was never
 * started and the editor was shown instead. These cases pin the split: every
 * runnable type goes to the shell's default action where the host has one, a
 * real executable on Linux gets an explanation instead of binary bytes, and a
 * text file keeps the viewer it had.
 */
const { runCommand, absolutePathOf, isRealFile, readFileBytes } = vi.hoisted(() => ({
  runCommand: vi.fn(async (): Promise<{ kind: 'launched'; argv: string[] } | { kind: 'error'; reason: string }> => ({
    kind: 'launched',
    argv: ['C:\\Descargas\\setup.exe'],
  })),
  absolutePathOf: vi.fn(
    (file: { path: string; name: string; fullName?: string; ext: string }) =>
      `${file.path}\\${file.fullName ?? `${file.name}.${file.ext}`}`,
  ),
  isRealFile: vi.fn(() => true),
  readFileBytes: vi.fn(async () => new Uint8Array()),
}));

vi.mock('../services/runLauncher', async () => {
  const actual = await vi.importActual<typeof import('../services/runLauncher')>('../services/runLauncher');
  return { ...actual, runCommand };
});
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

const WINDOWS = {
  platform: 'win32' as const,
  caseSensitive: false,
  separator: '\\' as const,
  capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
};

const LINUX = {
  ...WINDOWS,
  platform: 'linux' as const,
  caseSensitive: true,
  separator: '/' as const,
  capabilities: { ...WINDOWS.capabilities, openWith: false },
};

beforeEach(() => {
  setCurrentLang('es');
  setPlatformInfo(WINDOWS);
});

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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('usePanels openItem', () => {
  it.each([
    ['exe', 'programa'],
    ['lnk', 'acceso'],
    ['msi', 'instalador'],
    ['cpl', 'applet'],
    ['msc', 'consola'],
  ])('starts a .%s instead of loading it into the viewer', async (ext, name) => {
    const deps = await open(item(name, ext));

    expect(runCommand).toHaveBeenCalledWith(`"C:\\Descargas\\${name}.${ext}"`);
    expect(readFileBytes).not.toHaveBeenCalled();
    expect(deps.setSelectedFileForModal).not.toHaveBeenCalled();
    expect(deps.setActiveModal).not.toHaveBeenCalled();
  });

  it('quotes a path with spaces so /api/run keeps it as one target', async () => {
    const target = { ...item('setup', 'exe'), path: 'C:\\Program Files\\App' } as FileItem;
    await open(target);

    expect(runCommand).toHaveBeenCalledWith('"C:\\Program Files\\App\\setup.exe"');
  });

  it('shows why a program could not be started', async () => {
    runCommand.mockResolvedValueOnce({ kind: 'error', reason: 'program-not-found' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const deps = await open(item('setup', 'exe'));

    expect(alertSpy).toHaveBeenCalledWith(getTranslations('es').runErrorProgramNotFound);
    expect(deps.setSelectedFileForModal).not.toHaveBeenCalled();
    expect(deps.setActiveModal).not.toHaveBeenCalled();
  });

  it('explains on Linux that a Windows executable cannot run instead of showing its bytes', async () => {
    setPlatformInfo(LINUX);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const deps = await open(item('setup', 'exe'));

    expect(runCommand).not.toHaveBeenCalled();
    expect(readFileBytes).not.toHaveBeenCalled();
    expect(deps.setSelectedFileForModal).not.toHaveBeenCalled();
    expect(deps.setActiveModal).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(getTranslations('es').linuxCannotRunWindows);
  });

  it('keeps an archived executable in the viewer without the host warning', async () => {
    setPlatformInfo(LINUX);
    isRealFile.mockReturnValueOnce(false);
    const archived = { ...item('setup', 'exe'), archiveRoot: 'C:\\Descargas\\paquete.zip' } as FileItem;
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const deps = await open(archived);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(deps.setActiveModal).toHaveBeenCalledWith('viewer');
  });

  it('still opens a text file in the viewer', async () => {
    const deps = await open(item('notas', 'txt', 'hola'));

    expect(runCommand).not.toHaveBeenCalled();
    expect(deps.setSelectedFileForModal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'notas', content: 'hola' }),
    );
    expect(deps.setActiveModal).toHaveBeenCalledWith('viewer');
  });
});
