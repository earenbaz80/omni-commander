import { describe, expect, it } from 'vitest';
import { BackgroundTask, TransferPlan } from '../types';
import { lastRepeatablePlan, repeatPlanOf } from './taskRepeat';

const plan = (targetDir: string): TransferPlan => ({
  op: 'copy',
  sourceDriveId: 'real_C',
  targetDriveId: 'real_C',
  targetDir,
  overwrite: false,
  collision: 'ask',
  throttleBps: 0,
  entries: [{ path: `${targetDir}\\a.txt`, name: 'a.txt', isDirectory: false, size: 10 }],
});

const task = (id: string, status: BackgroundTask['status'], withPlan?: TransferPlan): BackgroundTask => ({
  id,
  type: 'copy',
  title: id,
  progress: 0,
  status,
  createdAt: '00:00',
  plan: withPlan,
});

/**
 * A repeat is only honest when there is something to repeat: the plan a transfer kept
 * when it stopped or failed. These cases pin that, and which one the tray picks as
 * "the last".
 */
describe('repeating a stopped or failed transfer', () => {
  it('has a plan for a cancelled or failed transfer that kept one', () => {
    const kept = plan('C:\\a');
    const lost = plan('C:\\c');
    expect(repeatPlanOf(task('cancelled', 'cancelled', kept))).toBe(kept);
    expect(repeatPlanOf(task('cancelled-no-plan', 'cancelled'))).toBeUndefined();
    // A job that ended with per-file errors reaches the queue as failed.
    expect(repeatPlanOf({ ...task('errored', 'failed', lost), error: 'access denied' })).toBe(lost);
    expect(repeatPlanOf(task('failed-no-plan', 'failed'))).toBeUndefined();
    expect(repeatPlanOf(task('completed', 'completed', plan('C:\\b')))).toBeUndefined();
    expect(repeatPlanOf(null)).toBeUndefined();
  });

  it('offers the newest stopped or failed transfer, not an older one or a finished one', () => {
    const newest = plan('C:\\newest');
    const tasks = [
      task('done', 'completed', plan('C:\\done')),
      task('errored', 'failed', newest),
      task('stopped-older', 'cancelled', plan('C:\\older')),
    ];

    expect(lastRepeatablePlan(tasks)).toBe(newest);
  });

  it('offers nothing for a transfer that is still moving, even with a plan', () => {
    expect(
      lastRepeatablePlan([task('done', 'completed', plan('C:\\a')), task('live', 'queued', plan('C:\\b'))]),
    ).toBeUndefined();
    expect(lastRepeatablePlan([])).toBeUndefined();
  });
});
