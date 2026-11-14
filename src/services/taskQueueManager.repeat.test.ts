// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferPlan } from '../types';
import { taskQueue } from './taskQueueManager';

/**
 * Clearing the list is a tidy-up, not a verdict on the transfer: a copy that failed is
 * still repeatable after its row is gone, and its plan is the whole of what a repeat
 * replays. The tray reads the same plan, so its `Repeat` row has to survive the clear
 * too.
 */
const plan = (targetDir: string): TransferPlan => ({
  op: 'copy',
  sourceDriveId: 'real_C',
  targetDriveId: 'real_C',
  targetDir,
  overwrite: false,
  collision: 'ask',
  throttleBps: 0,
  entries: [],
});

const failCopy = async (withPlan: TransferPlan) => {
  taskQueue.addTask(
    'copy',
    'Copy 2 items',
    'C:\\dest',
    10,
    async () => {
      throw new Error('EPERM: operation not permitted');
    },
    withPlan,
  );
  await vi.waitFor(() => expect(taskQueue.getTasks().some((task) => task.status === 'failed')).toBe(true));
};

describe('the list and what can be repeated', () => {
  beforeEach(() => {
    taskQueue.clearCompleted();
  });

  it('keeps the newest repeatable plan after the task is gone', async () => {
    const kept = plan('C:\\kept');
    await failCopy(kept);

    taskQueue.clearCompleted();

    expect(taskQueue.getTasks()).toEqual([]);
    expect(taskQueue.lastRepeatablePlan()).toEqual({ ...kept, resume: true });
  });

  it('prefers a later failure in the list over the one it remembered', async () => {
    const newer = plan('C:\\newer');
    await failCopy(newer);

    expect(taskQueue.lastRepeatablePlan()).toEqual({ ...newer, resume: true });
  });
});
