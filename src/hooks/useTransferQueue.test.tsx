import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransferQueue } from './useTransferQueue';
import type { FileItem, PanelTab, TransferPlan } from '../types';

const { addTask, parked, parkPlan, takePlan } = vi.hoisted(() => ({
  addTask: vi.fn(() => 'task-1'),
  parked: { current: null as TransferPlan | null },
  parkPlan: vi.fn(),
  takePlan: vi.fn(() => parked.current),
}));

vi.mock('../services/pendingTransfer', () => ({
  parkTransferPlan: parkPlan,
  takeParkedTransferPlan: takePlan,
}));

vi.mock('../services/fileSystem', () => ({
  fsEngine: {
    getArchiveSource: () => undefined,
    isRealFile: () => true,
    isSystemDrive: () => true,
    absolutePathOf: (item: FileItem) => `C:\\${item.name}`,
    checkFreeSpace: async () => null,
  },
}));

vi.mock('../services/taskQueueManager', () => ({
  taskQueue: {
    addTask,
    getPlan: () => undefined,
    updateTaskMeta: vi.fn(),
    updateTaskFiles: vi.fn(),
  },
}));

const tab = (driveId: string) => ({ driveId, currentPath: 'C:\\' }) as unknown as PanelTab;

const plan: TransferPlan = {
  op: 'copy',
  sourceDriveId: 'real_C',
  targetDriveId: 'real_D',
  targetDir: 'D:\\respaldo',
  overwrite: false,
  collision: 'ask',
  throttleBps: 0,
  entries: [{ path: 'C:\\informe.txt', name: 'informe.txt', isDirectory: false, size: 3 }],
};

const deps = () => ({
  lang: 'es' as const,
  transferItems: [],
  currentActiveTab: tab('real_C'),
  currentInactiveTab: tab('real_D'),
  setFsTick: vi.fn(),
});

type ElevationBridge = { relaunchAsAdmin: () => Promise<{ ok: boolean; reason?: string }> };
type WindowWithBridge = Window & { electronAPI?: ElevationBridge };

beforeEach(() => {
  addTask.mockClear();
  parkPlan.mockClear();
  takePlan.mockClear();
  parked.current = null;
});

afterEach(() => {
  delete (window as WindowWithBridge).electronAPI;
});

describe('useTransferQueue', () => {
  /**
   * Elevation restarts the process, so the transfer the user approved travels in
   * local storage and is replayed by the fresh instance — exactly once, or every
   * later mount would copy the same batch again.
   */
  it('replays the plan parked across an elevated restart, once', () => {
    parked.current = plan;
    renderHook(() => useTransferQueue(deps()));

    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith(
      'copy',
      expect.any(String),
      expect.stringContaining('respaldo'),
      3,
      expect.any(Function),
      plan,
    );
  });

  it('starts with no prompt on screen when nothing was parked', () => {
    const { result } = renderHook(() => useTransferQueue(deps()));

    expect(addTask).not.toHaveBeenCalled();
    expect(result.current.conflictPrompt).toBeNull();
    expect(result.current.freeSpacePrompt).toBeNull();
  });

  /**
   * Ctrl+V names its destination: the folder of the panel the user is on. The
   * dialog flow cannot, because there the target is always the other panel, so
   * the clipboard has to carry both the items and the drive it pastes into.
   */
  it('pastes the clipboard into the active folder instead of the other panel', async () => {
    const { result } = renderHook(() => useTransferQueue(deps()));
    const item = {
      id: 'f1',
      name: 'informe.txt',
      driveId: 'real_C',
      path: 'C:\\datos',
      isDirectory: false,
      size: 3,
    } as FileItem;

    const taskId = await result.current.handlePasteTransfer('copy', 'real_E', 'E:\\destino', [item]);

    expect(taskId).toBe('task-1');
    expect(addTask).toHaveBeenCalledWith(
      'copy',
      expect.any(String),
      expect.stringContaining('E:\\destino'),
      3,
      expect.any(Function),
      expect.objectContaining({ sourceDriveId: 'real_C', targetDriveId: 'real_E', targetDir: 'E:\\destino' }),
    );
  });

  it('pasting an empty clipboard starts nothing', async () => {
    const { result } = renderHook(() => useTransferQueue(deps()));

    await expect(result.current.handlePasteTransfer('move', 'real_E', 'E:\\destino', [])).resolves.toBeUndefined();
    expect(addTask).not.toHaveBeenCalled();
  });

  it('dismissing the free-space prompt leaves no job behind', () => {
    const { result } = renderHook(() => useTransferQueue(deps()));

    result.current.dismissFreeSpacePrompt();

    // Forcing with nothing held must not enqueue an empty batch either.
    result.current.handleForceTransfer();
    expect(addTask).not.toHaveBeenCalled();
  });

  /**
   * Elevation restarts the process, so the plan is parked before the restart and
   * replayed by the fresh instance. But a cancelled UAC leaves this process
   * alive: the plan must not outlive that refusal, or the next launch runs the
   * copy unelevated and without asking again.
   */
  const realItem = {
    id: 'f1',
    name: 'informe.txt',
    driveId: 'real_C',
    path: 'C:\\datos\\informe.txt',
    isDirectory: false,
    size: 3,
  } as FileItem;
  const transferOptions = { collision: 'ask' as const, throttleBps: 0 };
  const elevatingDeps = () => ({ ...deps(), transferItems: [realItem] });
  const installBridge = (answer: { ok: boolean; reason?: string } | Error) => {
    const relaunchAsAdmin = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
    (window as WindowWithBridge).electronAPI = { relaunchAsAdmin };
    return relaunchAsAdmin;
  };

  it('keeps the parked plan only when the elevated restart is confirmed', async () => {
    const relaunch = installBridge({ ok: true });
    const { result } = renderHook(() => useTransferQueue(elevatingDeps()));
    takePlan.mockClear();

    const answer = await result.current.handleElevateTransfer('copy', 'D:\\respaldo', transferOptions);

    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(parkPlan).toHaveBeenCalledTimes(1);
    expect(takePlan).not.toHaveBeenCalled();
    expect(answer).toEqual({ ok: true });
  });

  it('drops the parked plan when the UAC was cancelled', async () => {
    installBridge({ ok: false, reason: 'error' });
    const { result } = renderHook(() => useTransferQueue(elevatingDeps()));
    takePlan.mockClear();

    const answer = await result.current.handleElevateTransfer('copy', 'D:\\respaldo', transferOptions);

    expect(answer).toEqual({ ok: false, reason: 'error' });
    expect(parkPlan).toHaveBeenCalledTimes(1);
    expect(takePlan).toHaveBeenCalledTimes(1);
  });

  it('drops the parked plan when the bridge itself throws', async () => {
    installBridge(new Error('ipc closed'));
    const { result } = renderHook(() => useTransferQueue(elevatingDeps()));
    takePlan.mockClear();

    const answer = await result.current.handleElevateTransfer('copy', 'D:\\respaldo', transferOptions);

    expect(answer).toEqual({ ok: false, reason: 'ipc closed' });
    expect(takePlan).toHaveBeenCalledTimes(1);
  });

  it('parks nothing and says so when there is no bridge to restart through', async () => {
    const { result } = renderHook(() => useTransferQueue(elevatingDeps()));
    takePlan.mockClear();

    const answer = await result.current.handleElevateTransfer('copy', 'D:\\respaldo', transferOptions);

    expect(answer).toEqual({ ok: false, reason: 'unsupported' });
    expect(parkPlan).not.toHaveBeenCalled();
    expect(takePlan).not.toHaveBeenCalled();
  });
});
