import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransferQueue } from './useTransferQueue';
import type { PanelTab, TransferPlan } from '../types';

const { addTask, parked } = vi.hoisted(() => ({
  addTask: vi.fn(() => 'task-1'),
  parked: { current: null as TransferPlan | null },
}));

vi.mock('../services/pendingTransfer', () => ({
  parkTransferPlan: vi.fn(),
  takeParkedTransferPlan: () => parked.current,
}));

vi.mock('../services/fileSystem', () => ({ fsEngine: {} }));

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

beforeEach(() => {
  addTask.mockClear();
  parked.current = null;
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

  it('dismissing the free-space prompt leaves no job behind', () => {
    const { result } = renderHook(() => useTransferQueue(deps()));

    result.current.dismissFreeSpacePrompt();

    // Forcing with nothing held must not enqueue an empty batch either.
    result.current.handleForceTransfer();
    expect(addTask).not.toHaveBeenCalled();
  });
});
