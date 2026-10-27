import { TransferPlan, TransferPlanEntry } from '../types';

/**
 * Identity of a plan entry for duplicate detection.
 *
 * Windows treats `C:\Temp\` and `c:\temp` as the same folder, and the native
 * picker happily returns the trailing-separator form, so trimming the separator
 * and comparing case-insensitively is what keeps one file from being queued
 * twice under two spellings.
 */
export function planEntryKey(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

export interface PlanMerge {
  plan: TransferPlan;
  added: TransferPlanEntry[];
  /** Entries dropped because the list already had them (or they were empty). */
  skipped: number;
}

/**
 * Appends newly picked entries to a plan without duplicating what is already
 * queued. The returned plan is a new object only when something was added, so a
 * picker that returns the same files twice cannot churn the task list.
 */
export function addEntriesToPlan(plan: TransferPlan, entries: TransferPlanEntry[]): PlanMerge {
  const seen = new Set(plan.entries.map((entry) => planEntryKey(entry.path)));
  const added: TransferPlanEntry[] = [];
  let skipped = 0;

  for (const entry of entries) {
    const key = planEntryKey(entry.path);
    if (!key || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    added.push(entry);
  }

  return {
    plan: added.length > 0 ? { ...plan, entries: [...plan.entries, ...added] } : plan,
    added,
    skipped,
  };
}

/**
 * Bytes a plan can promise before any job starts. Folders are 0 because their
 * real size only exists once the server measures the tree.
 */
export function planFileBytes(plan: TransferPlan): number {
  return plan.entries.reduce((acc, entry) => acc + (entry.isDirectory ? 0 : entry.size), 0);
}
