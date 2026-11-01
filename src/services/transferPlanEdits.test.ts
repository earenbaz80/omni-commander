// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addEntriesToPlan, planEntryKey, planFileBytes } from './transferPlanEdits';
import { TransferPlan, TransferPlanEntry } from '../types';

/**
 * The transfer window appends whatever the native picker returns, and the same
 * file can come back twice under different spellings. These tests pin the
 * dedupe rule and the byte total, because a wrong one either copies a file twice
 * or makes the progress bar lie.
 */

const entry = (path: string, isDirectory = false, size = 10): TransferPlanEntry => ({
  path,
  name: path.split('\\').pop() || path,
  isDirectory,
  size,
});

const plan = (entries: TransferPlanEntry[]): TransferPlan => ({
  op: 'copy',
  sourceDriveId: 'real_T',
  targetDriveId: 'real_T',
  targetDir: 'T:\\dest',
  overwrite: false,
  collision: 'overwrite',
  throttleBps: 0,
  entries,
});

describe('plan entry identity', () => {
  it('treats trailing separators, whitespace and case as the same path', () => {
    expect(planEntryKey('C:\\Temp\\File.TXT')).toBe(planEntryKey(' c:\\temp\\file.txt '));
    expect(planEntryKey('C:\\Temp\\')).toBe(planEntryKey('C:\\Temp'));
  });
});

describe('appending picked entries', () => {
  it('appends new entries and keeps the original order', () => {
    const base = plan([entry('T:\\a.txt')]);
    const result = addEntriesToPlan(base, [entry('T:\\b.txt'), entry('T:\\folder', true, 0)]);

    expect(result.added.map((e) => e.name)).toEqual(['b.txt', 'folder']);
    expect(result.plan.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'folder']);
    expect(base.entries).toHaveLength(1);
  });

  it('drops a file that is already queued under another spelling', () => {
    const base = plan([entry('T:\\Temp\\a.txt')]);
    const result = addEntriesToPlan(base, [entry('t:\\temp\\A.TXT'), entry('T:\\b.txt')]);

    expect(result.added).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.plan.entries.map((e) => e.path)).toEqual(['T:\\Temp\\a.txt', 'T:\\b.txt']);
  });

  it('returns the same plan when nothing new arrived', () => {
    const base = plan([entry('T:\\a.txt')]);
    const result = addEntriesToPlan(base, [entry('T:\\a.txt'), entry('   ')]);

    expect(result.added).toHaveLength(0);
    expect(result.plan).toBe(base);
  });
});

describe('plan byte total', () => {
  it('counts files only, because folders are measured by the job', () => {
    expect(
      planFileBytes(plan([entry('T:\\a.txt', false, 30), entry('T:\\b.txt', false, 12), entry('T:\\dir', true, 0)])),
    ).toBe(42);
  });
});
