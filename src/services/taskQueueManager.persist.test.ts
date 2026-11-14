// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { TransferPlan } from '../types';
import { readStoppedPlan } from './stoppedPlanStore';
import { taskQueue } from './taskQueueManager';

/**
 * The queue is lost when the window closes, and with it every failed transfer. The
 * plan is written as soon as a transfer stops, so the repeat offered later is the one
 * a restarted session can still honour.
 */
const plan: TransferPlan = {
  op: 'copy',
  sourceDriveId: 'real_C',
  targetDriveId: 'real_C',
  targetDir: 'C:\\destino',
  overwrite: false,
  collision: 'ask',
  throttleBps: 0,
  entries: [{ path: 'C:\\a.txt', name: 'a.txt', isDirectory: false, size: 10 }],
};

describe('a transfer that stops', () => {
  beforeEach(() => {
    localStorage.clear();
    taskQueue.clearCompleted();
  });

  it('writes its plan out so the repeat outlives the window', () => {
    const id = taskQueue.addTask('copy', 'Copy 1 item', 'C:\\destino', 10, () => new Promise<void>(() => {}), plan);

    taskQueue.cancelTask(id);

    expect(readStoppedPlan()).toEqual(plan);
  });
});
