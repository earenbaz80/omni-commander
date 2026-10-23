import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CopyMoveModal } from './CopyMoveModal';
import { themes } from '../../services/themeManager';
import { taskQueue } from '../../services/taskQueueManager';
import { fsEngine } from '../../services/fileSystem';
import { TransferPlan } from '../../types';

/**
 * The native picker is an OS dialog, so the only part worth pinning down here is
 * the wiring behind the button: picked paths are sized by the server and land in
 * the plan of the transfer that is on screen.
 */

const plan: TransferPlan = {
  op: 'copy',
  sourceDriveId: 'real_T',
  targetDriveId: 'real_T',
  targetDir: 'T:\\dest',
  overwrite: false,
  collision: 'overwrite',
  throttleBps: 0,
  entries: [{ path: 'T:\\a.txt', name: 'a.txt', isDirectory: false, size: 10 }]
};

let runningId = '';

afterEach(() => {
  if (runningId) taskQueue.cancelTask(runningId);
  taskQueue.clearCompleted();
  runningId = '';
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('CopyMoveModal native picker', () => {
  it('appends picked files to the transfer list on screen', async () => {
    // A transfer that never settles keeps the window in monitor mode, which is
    // exactly the state where a user adds more files to the list.
    runningId = taskQueue.addTask('copy', 'Copy 1', 'to T:\\dest', 10, () => new Promise<void>(() => {}), plan);

    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      pickPaths: async (mode: string) => (mode === 'files' ? ['T:\\picked.txt'] : [])
    };
    const inspect = vi.spyOn(fsEngine, 'inspectPaths').mockResolvedValue({
      entries: [{ path: 'T:\\picked.txt', name: 'picked.txt', isDirectory: false, size: 55 }],
      missing: []
    });

    render(
      <CopyMoveModal
        type="copy"
        theme={themes.classic_blue}
        lang="en"
        items={[]}
        targetPath="T:\\dest"
        onConfirm={() => undefined}
        onClose={() => undefined}
      />
    );

    screen.getByText('Add files').click();

    await waitFor(() => {
      expect(taskQueue.getPlan(runningId)?.entries.map(entry => entry.name)).toEqual(['a.txt', 'picked.txt']);
    });
    expect(inspect).toHaveBeenCalledWith(['T:\\picked.txt']);
    expect(taskQueue.getTasks().find(task => task.id === runningId)?.totalBytes).toBe(65);
    expect(await screen.findByText('Add files: +1')).toBeTruthy();
  });
});
