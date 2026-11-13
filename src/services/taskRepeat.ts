import { BackgroundTask, TransferPlan } from '../types';

/**
 * What can be repeated: a stopped transfer keeps the plan it was built from, and
 * that plan is the only thing a repeat has to hand back. A transfer that finished
 * or failed has nothing left to replay, and a delete never had a plan.
 *
 * The window and the tray both ask this, so one of them cannot end up offering a
 * repeat the other refuses.
 */
export function repeatPlanOf(task: BackgroundTask | null | undefined): TransferPlan | undefined {
  return task && task.status === 'cancelled' ? task.plan : undefined;
}

/**
 * The last transfer that can be repeated. The queue keeps its tasks newest first,
 * so the first stopped one with a plan is the most recent thing that was cancelled.
 */
export function lastRepeatablePlan(tasks: BackgroundTask[]): TransferPlan | undefined {
  for (const task of tasks) {
    const plan = repeatPlanOf(task);
    if (plan) return plan;
  }
  return undefined;
}
