import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackgroundTasksModal } from './BackgroundTasksModal';
import { themes } from '../../services/themeManager';
import { taskQueue } from '../../services/taskQueueManager';
import { TransferPlan } from '../../types';

/**
 * Cancelling a transfer is destructive enough that the way back matters: the queue
 * keeps the plan the task was built from, and repeating it must hand exactly that
 * batch back rather than an empty or rebuilt one.
 */
const plan: TransferPlan = {
  op: 'copy',
  sourceDriveId: 'real_C',
  targetDriveId: 'real_C',
  targetDir: 'C:\\dest',
  overwrite: false,
  collision: 'ask',
  throttleBps: 0,
  entries: [{ path: 'C:\\a.txt', name: 'a.txt', isDirectory: false, size: 10 }],
};

const renderModal = () => {
  const onRunCopyList = vi.fn();
  render(
    <BackgroundTasksModal theme={themes.classic_blue} lang="en" onRunCopyList={onRunCopyList} onClose={() => {}} />,
  );
  return { onRunCopyList };
};

describe('the background tasks queue', () => {
  beforeEach(() => {
    // A task left over by the previous case would be another row in the list.
    for (const task of taskQueue.getTasks()) taskQueue.cancelTask(task.id);
    taskQueue.clearCompleted();
  });

  it('repeats a cancelled transfer from the plan it kept', () => {
    const id = taskQueue.addTask('copy', 'Copy 2 items', 'C:\\dest', 10, () => new Promise<void>(() => {}), plan);
    taskQueue.cancelTask(id);
    const { onRunCopyList } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }));

    expect(onRunCopyList).toHaveBeenCalledWith([plan]);
  });

  it('offers nothing to repeat when the transfer left no plan behind', () => {
    const id = taskQueue.addTask('delete', 'Delete 2 items', 'C:\\dest');
    taskQueue.cancelTask(id);
    renderModal();

    expect(screen.getByText('Delete 2 items')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repeat' })).toBeNull();
  });
});
