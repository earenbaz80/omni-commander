import { TransferPlan } from '../types';

/**
 * The plan of a transfer that stopped, kept across restarts.
 *
 * The queue lives in the window's memory, so a failed copy followed by closing the
 * app used to lose the only thing "Repeat" had to replay. This is the smallest place
 * to keep it: a saved plan is already what a copy list is made of, so it is JSON and
 * nothing else needs to be stored. A plan too large for the browser's quota simply
 * does not survive the restart, which is the same outcome as before and never an error
 * the user has to deal with.
 */
const KEY = 'omni.stoppedPlan';

function storage(): Storage | undefined {
  try {
    // Node tests import the queue without a window; there is nothing to persist there.
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A saved plan is data from an older session: only the fields a replay needs count. */
function isPlan(value: unknown): value is TransferPlan {
  const plan = value as TransferPlan | null;
  return (
    !!plan &&
    typeof plan === 'object' &&
    (plan.op === 'copy' || plan.op === 'move') &&
    typeof plan.targetDir === 'string' &&
    Array.isArray(plan.entries)
  );
}

export function readStoppedPlan(): TransferPlan | undefined {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return undefined;
    const plan: unknown = JSON.parse(raw);
    return isPlan(plan) ? plan : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoppedPlan(plan: TransferPlan | undefined): void {
  const store = storage();
  if (!store) return;
  try {
    if (!plan) store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify(plan));
  } catch {
    /* quota or a locked store: the plan just does not survive */
  }
}
