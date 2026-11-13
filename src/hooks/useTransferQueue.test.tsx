import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransferQueue } from './useTransferQueue';
import { taskQueue } from '../services/taskQueueManager';
import type { FileItem, PanelTab, TransferPlan } from '../types';

const { addTask, parked, parkPlan, takePlan, transferPaths } = vi.hoisted(() => ({
  addTask: vi.fn(() => 'task-1'),
  parked: { current: null as TransferPlan | null },
  parkPlan: vi.fn(),
  takePlan: vi.fn(() => parked.current),
  transferPaths: vi.fn(),
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
    // The executor's work, replaced per case: only the conflict and the cancel
    // signal matter to the prompt.
    transferPaths,
    loadSystemDriveDirectory: async () => {},
    getParentPath: () => 'C:\\',
  },
}));

vi.mock('../services/taskQueueManager', () => ({
  taskQueue: {
    addTask,
    getPlan: () => undefined,
    updateTaskMeta: vi.fn(),
    updateTaskFiles: vi.fn(),
    setWaitingForAnswer: vi.fn(),
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
  transferPaths.mockReset();
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

  /**
   * The prompt belongs to a job, and the task behind it can be stopped from the
   * tray or the queue bar while the prompt is on screen. Nothing else would take it
   * down: the user would be answering a question for a transfer that already ended,
   * and the engine job would stay parked holding a slot.
   */
  it('takes the conflict prompt down when the transfer is cancelled from elsewhere', async () => {
    let runExecutor:
      ((onProgress: unknown, signal: { paused: boolean; cancelled: boolean }) => Promise<void>) | undefined;
    addTask.mockImplementation((...args: unknown[]) => {
      runExecutor = args[4] as typeof runExecutor;
      return 'task-1';
    });
    const signal = { paused: false, cancelled: false };
    // A parked job is polled until the cancel reaches the server; this is the poll
    // that only ends once the queue's signal says so.
    let release = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    transferPaths.mockImplementation(async (...args: unknown[]) => {
      (args[7] as (conflict: unknown) => void)({
        jobId: 'job_9',
        source: 'C:\\a.txt',
        destination: 'D:\\a.txt',
        name: 'a.txt',
        sourceSize: 3,
        destinationSize: 4,
        sourceModified: 1,
        destinationModified: 2,
        identical: false,
      });
      await parked;
    });

    const { result } = renderHook(() => useTransferQueue(deps()));
    await result.current.handleRunCopyList([plan]);
    const run = runExecutor!((): void => {}, signal);
    await waitFor(() => expect(result.current.conflictPrompt).not.toBeNull());

    // What the tray's cancel does to the task it mirrors.
    signal.cancelled = true;
    release();
    await run;

    await waitFor(() => expect(result.current.conflictPrompt).toBeNull());
  });

  it('takes the prompt down when its job is answered somewhere else', async () => {
    // The dashboard answers the same job without going through this window, so the
    // prompt here would stay on screen and send its answer to a job that is no
    // longer parked: the job's own poll is what says it is moving again.
    vi.mocked(taskQueue.setWaitingForAnswer).mockClear();
    let runExecutor:
      ((onProgress: unknown, signal: { paused: boolean; cancelled: boolean }) => Promise<void>) | undefined;
    addTask.mockImplementation((...args: unknown[]) => {
      runExecutor = args[4] as typeof runExecutor;
      return 'task-1';
    });
    let unparked: (jobId: string) => void = () => {};
    let release = () => {};
    transferPaths.mockImplementation(async (...args: unknown[]) => {
      (args[7] as (conflict: unknown) => void)({
        jobId: 'job_9',
        source: 'C:\\a.txt',
        destination: 'D:\\a.txt',
        name: 'a.txt',
      });
      unparked = args[10] as typeof unparked;
      // Still parked until the test says otherwise, so nothing below can be the
      // executor's own cleanup at the end of the transfer.
      await new Promise<void>((resolve) => (release = resolve));
    });

    const { result } = renderHook(() => useTransferQueue(deps()));
    await result.current.handleRunCopyList([plan]);
    const run = runExecutor!(() => {}, { paused: false, cancelled: false });
    await waitFor(() => expect(result.current.conflictPrompt).not.toBeNull());

    unparked('job_9');

    await waitFor(() => expect(result.current.conflictPrompt).toBeNull());
    expect(vi.mocked(taskQueue.setWaitingForAnswer).mock.calls).toEqual([
      ['job_9', true],
      ['job_9', false],
    ]);

    release();
    await run;
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
