import type { TransferPlan } from '../types';
import { readStored, removeStored, writeStored, type StoredSpec } from './storage';

const KEY = 'omnicommander.pendingElevatedTransfer';

/**
 * A plan only needs its entries to be replayable; the rest of the object comes
 * from the build that wrote it, and rejecting a whole transfer over a field this
 * build no longer reads would lose the copy the user already confirmed.
 */
const isPlan = (value: unknown): value is TransferPlan =>
  typeof value === 'object' && value !== null && Array.isArray((value as { entries?: unknown }).entries);

const PLAN_SPEC: StoredSpec<TransferPlan | null> = {
  fallback: null,
  validate: isPlan,
  version: 1,
  // A plan half-written by a killed process is dropped, never replayed blindly.
  migrate: (value) => (isPlan(value) ? value : null),
};

/**
 * Parks the plan the elevated instance will replay. Elevation restarts the
 * process, and a full quota must not block the elevation itself, so nothing here
 * can throw at the caller.
 */
export function parkTransferPlan(plan: TransferPlan): void {
  writeStored(KEY, plan, PLAN_SPEC.version ?? 1);
}

/** Consumes the parked plan once, so a restart replays it a single time. */
export function takeParkedTransferPlan(): TransferPlan | null {
  const plan = readStored(KEY, PLAN_SPEC);
  removeStored(KEY);
  return plan;
}
