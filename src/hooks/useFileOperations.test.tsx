import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileOperations } from './useFileOperations';
import type { FileItem, PanelTab, UserSettings } from '../types';

const { addTask, updateTaskMeta, playSuccess, deleteItems, createPasswordRecord, setSettings } = vi.hoisted(() => ({
  addTask: vi.fn(() => 'task-1'),
  updateTaskMeta: vi.fn(),
  playSuccess: vi.fn(),
  deleteItems: vi.fn(async () => undefined),
  createPasswordRecord: vi.fn(async () => ({ hash: 'derivado', salt: 'sal' })),
  setSettings: vi.fn(),
}));

vi.mock('../services/taskQueueManager', () => ({
  taskQueue: { addTask, updateTaskMeta, updateTaskFiles: vi.fn() },
}));

vi.mock('../services/soundEffects', () => ({
  soundManager: { playSuccess, playDiskAccess: vi.fn() },
}));

vi.mock('../services/appLock', () => ({ createPasswordRecord }));

vi.mock('../services/fileSystem', () => ({
  fsEngine: {
    deleteItems,
    getArchiveSource: () => undefined,
    createArchive: vi.fn(),
    isRealFile: () => false,
  },
}));

const item = (id: string): FileItem =>
  ({ id, name: id, path: 'carpeta', fullName: id, isDirectory: false, size: 1 }) as FileItem;
const tab = (driveId: string) => ({ driveId, currentPath: 'carpeta' }) as unknown as PanelTab;

const render = (settings: Partial<UserSettings> = {}) =>
  renderHook(() =>
    useFileOperations({
      lang: 'es',
      transferItems: [item('a'), item('b')],
      currentActiveTab: tab('real_C'),
      currentInactiveTab: tab('real_D'),
      settings: { useRecycleBin: true, protectedFolders: {}, ...settings } as unknown as UserSettings,
      setSettings,
      selectedFileForModal: null,
      modalData: null,
      setActiveModal: vi.fn(),
      setLeftPanel: vi.fn(),
      setRightPanel: vi.fn(),
      setFsTick: vi.fn(),
      getSelectedOrFocusedItems: () => [],
    }),
  );

/** Applies the updater the hook handed to setSettings, like React would. */
const appliedUpdater = (previous: Partial<UserSettings>) => {
  const updater = setSettings.mock.calls[setSettings.mock.calls.length - 1][0];
  return updater(previous);
};

beforeEach(() => {
  addTask.mockClear();
  updateTaskMeta.mockClear();
  setSettings.mockClear();
  createPasswordRecord.mockClear();
});

describe('useFileOperations', () => {
  /**
   * A delete used to resolve even after the engine threw, which marked the task
   * completed at 100% with the failure stored where nothing rendered it.
   */
  it('queues the delete as one task and clears the misleading byte speed', () => {
    const { result } = render();

    result.current.handleConfirmDelete();

    expect(addTask).toHaveBeenCalledWith('delete', expect.any(String), undefined, 2, expect.any(Function));
    expect(updateTaskMeta).toHaveBeenCalledWith('task-1', { speed: '' });
  });

  /**
   * Settings live in localStorage as JSON, so what is stored has to be the
   * derived record: a password written there would be readable by anyone with
   * the settings file.
   */
  it('stores a derived record for a protected folder, never the password', async () => {
    const { result } = render();

    await result.current.handleSetFolderPassword('carpeta/compartida', 'secreta');

    expect(createPasswordRecord).toHaveBeenCalledWith('secreta');
    const next = appliedUpdater({ protectedFolders: {} });
    expect(next.protectedFolders).toEqual({ 'carpeta/compartida': { hash: 'derivado', salt: 'sal' } });
    expect(JSON.stringify(next)).not.toContain('secreta');
  });

  it('removing the password drops only that folder', async () => {
    const { result } = render();

    await result.current.handleSetFolderPassword('carpeta/compartida', null);

    const next = appliedUpdater({
      protectedFolders: { 'carpeta/compartida': { hash: 'h', salt: 's' }, otra: { hash: 'x', salt: 'y' } },
    });
    expect(next.protectedFolders).toEqual({ otra: { hash: 'x', salt: 'y' } });
  });

  it('starts nothing when there is no selection to compress', async () => {
    const { result } = render();

    await result.current.handleCompressZip('respaldo', 'ZIP');

    expect(addTask).not.toHaveBeenCalled();
  });
});
