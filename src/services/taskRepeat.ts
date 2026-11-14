import { BackgroundTask, TransferPlan } from '../types';

/**
 * What can be repeated: a transfer that stopped or failed keeps the plan it was
 * built from, and that plan is the only thing a repeat has to hand back. A transfer
 * that ran to the end has nothing left to replay, and a delete never had a plan.
 *
 * The plan comes back as a copy marked `resume`, so a repeat continues the batch
 * instead of starting it over, and the task that kept the plan is left untouched.
 *
 * A job that ends with per-file errors arrives here as failed: the transfer raises
 * the engine's first error once the job stops.
 *
 * The window and the tray both ask this, so one of them cannot end up offering a
 * repeat the other refuses.
 */
export function repeatPlanOf(task: BackgroundTask | null | undefined): TransferPlan | undefined {
  const plan = task && (task.status === 'cancelled' || task.status === 'failed') ? task.plan : undefined;
  return plan && { ...plan, resume: true };
}

/**
 * The last transfer that can be repeated. The queue keeps its tasks newest first,
 * so the first stopped or failed one with a plan is the most recent thing worth
 * repeating.
 */
export function lastRepeatablePlan(tasks: BackgroundTask[]): TransferPlan | undefined {
  for (const task of tasks) {
    const plan = repeatPlanOf(task);
    if (plan) return plan;
  }
  return undefined;
}
