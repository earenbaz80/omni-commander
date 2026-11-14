// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { TransferPlan } from '../types';
import { readStoppedPlan, writeStoppedPlan } from './stoppedPlanStore';

/**
 * "Repeat" replays a plan kept in the window's memory, so a failed copy followed by
 * closing the app lost the only way back. What is written here is what makes the row
 * mean something after a restart, and it is data from an older session on the way
 * back in, so a value that is not a plan has to be ignored rather than replayed.
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

describe('the stopped plan kept for a repeat', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads back what it wrote', () => {
    writeStoppedPlan(plan);

    expect(readStoppedPlan()).toEqual(plan);
  });

  it('forgets the plan when there is nothing to repeat', () => {
    writeStoppedPlan(plan);
    writeStoppedPlan(undefined);

    expect(readStoppedPlan()).toBeUndefined();
  });

  it('ignores a value that is not a plan', () => {
    localStorage.setItem('omni.stoppedPlan', '{"op":"delete","entries":[]}');
    expect(readStoppedPlan()).toBeUndefined();

    localStorage.setItem('omni.stoppedPlan', 'not json');
    expect(readStoppedPlan()).toBeUndefined();
  });
});
