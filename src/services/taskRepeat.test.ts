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
 * A repeat is only honest when there is something to repeat: the plan a stopped
 * transfer kept. These cases pin that, and which one the tray picks as "the last".
 */
describe('repeating a stopped transfer', () => {
  it('has a plan only for a cancelled transfer that kept one', () => {
    const kept = plan('C:\\a');
    expect(repeatPlanOf(task('cancelled', 'cancelled', kept))).toBe(kept);
    expect(repeatPlanOf(task('cancelled-no-plan', 'cancelled'))).toBeUndefined();
    expect(repeatPlanOf(task('completed', 'completed', plan('C:\\b')))).toBeUndefined();
    expect(repeatPlanOf(task('failed', 'failed', plan('C:\\c')))).toBeUndefined();
    expect(repeatPlanOf(null)).toBeUndefined();
  });

  it('offers the newest stopped transfer, not an older one or a finished one', () => {
    const newest = plan('C:\\newest');
    const older = plan('C:\\older');
    const tasks = [
      task('done', 'completed', plan('C:\\done')),
      task('stopped-newest', 'cancelled', newest),
      task('stopped-older', 'cancelled', older),
    ];

    expect(lastRepeatablePlan(tasks)).toBe(newest);
  });

  it('offers nothing when no stopped transfer kept a plan', () => {
    expect(lastRepeatablePlan([task('done', 'completed'), task('failed', 'failed')])).toBeUndefined();
    expect(lastRepeatablePlan([])).toBeUndefined();
  });
});
