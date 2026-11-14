import { BackgroundTask, FileProgressEntry, TransferPlan } from '../types';
import { formatSpeed } from '../utils/formatSpeed';
import { lastRepeatablePlan as newestRepeatablePlan } from './taskRepeat';
import { readStoppedPlan, writeStoppedPlan } from './stoppedPlanStore';

export interface OperationSignal {
  paused: boolean;
  cancelled: boolean;
}

/** The statuses a task is still alive in. */
const LIVE_STATUSES = new Set<BackgroundTask['status']>(['queued', 'running', 'paused']);

export type ProgressCallback = (transferred: number, total: number) => void;
export type OperationExecutor = (onProgress: ProgressCallback, signal: OperationSignal) => Promise<void>;

class TaskQueueManager {
  /**
   * How many per-file rows a task keeps. The engine reports each job's tail, and
   * a transfer can touch hundreds of thousands of files, so the merged list is
   * capped to what a human could actually read.
   */
  private static readonly FILE_WINDOW = 60;

  private tasks: BackgroundTask[] = [];
  /** The newest plan a stopped transfer left behind, kept for a repeat after a restart. */
  private stoppedPlan?: TransferPlan = readStoppedPlan();
  private listeners: Array<() => void> = [];
  private executors: Map<string, OperationExecutor> = new Map();
  private signals: Map<string, OperationSignal> = new Map();
  private processing = false;

  // Intentionally empty: the queue must start with no tasks. A hardcoded
  // "finished" demo task used to seed this list, which kept the corner
  // indicator permanently visible and made real transfers look simulated.

  public getTasks(): BackgroundTask[] {
    return [...this.tasks];
  }

  public getActiveCount(): number {
    return this.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
  }

  /**
   * Live plan of one task. Executors read this on every step instead of keeping
   * the plan they were created with: the transfer window can append entries
   * while the job runs, and a snapshot would silently ignore them.
   */
  public getPlan(id: string): TransferPlan | undefined {
    return this.tasks.find((task) => task.id === id)?.plan;
  }

  /**
   * The planned transfers behind the queue, oldest first, which is the order a
   * saved copy list replays in. Tasks without a plan (delete, archive) have no
   * reproducible batch and are skipped.
   */
  public getPlans(): TransferPlan[] {
    return this.tasks
      .filter((task): task is BackgroundTask & { plan: TransferPlan } => !!task.plan)
      .map((task) => task.plan)
      .reverse();
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    // A transfer that ended while its prompt was open cannot still be waiting for an
    // answer; dropping the flag here covers every path to a terminal status at once.
    for (const task of this.tasks) {
      if (task.waitingForAnswer && !LIVE_STATUSES.has(task.status)) task.waitingForAnswer = false;
    }
    this.listeners.forEach((l) => l());
  }

  public addTask(
    type: BackgroundTask['type'],
    title: string,
    details?: string,
    totalBytes?: number,
    executor?: OperationExecutor,
    plan?: TransferPlan,
  ): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newTask: BackgroundTask = {
      id,
      type,
      title,
      details,
      progress: 0,
      status: 'queued',
      speed: formatSpeed(0),
      transferredBytes: 0,
      // Zero means "not measured yet", not one megabyte: the executor reports
      // the real total as soon as the server has it, and the bar stays at 0%
      // until then instead of showing progress through a made-up size.
      totalBytes: totalBytes && totalBytes > 0 ? totalBytes : 0,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      plan,
    };

    this.tasks.unshift(newTask);
    if (executor) {
      this.executors.set(id, executor);
      this.signals.set(id, { paused: false, cancelled: false });
    }
    this.notify();

    // Start processing queue if not already
    this.processQueue();

    return id;
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        // Find next queued task
        const task = this.tasks.find((t) => t.status === 'queued');
        if (!task) break;

        const executor = this.executors.get(task.id);
        if (!executor) {
          // No executor - mark as completed immediately (legacy behavior)
          task.status = 'completed';
          task.progress = 100;
          task.transferredBytes = task.totalBytes;
          this.notify();
          continue;
        }

        const signal = this.signals.get(task.id)!;
        task.status = 'running';
        this.notify();

        const startTime = Date.now();
        let lastTransferred = 0;
        let lastTime = startTime;

        try {
          await executor((transferred, total) => {
            if (signal.cancelled) return;
            // Pause/cancel is deliberately NOT awaited here: this callback is
            // synchronous, so blocking it would stall the event loop and freeze
            // the UI. The executor owns the pause loop (await + setTimeout) and
            // the server mirrors pause/cancel onto the real transfer.

            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            if (elapsed > 0.1) {
              task.speed = formatSpeed((transferred - lastTransferred) / elapsed);
              lastTransferred = transferred;
              lastTime = now;
            }

            task.transferredBytes = transferred;
            task.totalBytes = total || task.totalBytes;
            task.progress = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0;

            if (task.progress >= 100) {
              task.status = 'completed';
              task.transferredBytes = task.totalBytes;
            }
            this.notify();
          }, signal);

          // If not cancelled and not already completed by progress callback
          if (!signal.cancelled && task.status === 'running') {
            task.status = 'completed';
            task.progress = 100;
            task.transferredBytes = task.totalBytes;
            this.notify();
          }
        } catch (e) {
          if (!signal.cancelled) {
            task.status = 'failed';
            task.error = e instanceof Error ? e.message : 'Unknown error';
            this.rememberPlan(task.plan);
            this.notify();
          }
        }

        if (signal.cancelled) {
          task.status = 'cancelled';
          task.progress = 0;
          this.rememberPlan(task.plan);
          this.notify();
        }

        // Clean up
        this.executors.delete(task.id);
        this.signals.delete(task.id);
      }
    } finally {
      this.processing = false;
    }
  }

  public pauseTask(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (task && task.status === 'running') {
      task.status = 'paused';
      const signal = this.signals.get(id);
      if (signal) signal.paused = true;
      this.notify();
    }
  }

  public resumeTask(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (task && task.status === 'paused') {
      task.status = 'running';
      const signal = this.signals.get(id);
      if (signal) signal.paused = false;
      this.notify();
    }
  }

  public cancelTask(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.status = 'cancelled';
      const signal = this.signals.get(id);
      if (signal) signal.cancelled = true;
      this.rememberPlan(task.plan);
      this.notify();
    }
  }

  /**
   * Merges live transfer metadata (speed, ETA, current file, failure reason)
   * into a task. Only defined values are written, so a caller can update one
   * field at a time without clobbering the rest.
   */
  public updateTaskMeta(
    id: string,
    meta: {
      speed?: string;
      etaSeconds?: number;
      transferredBytes?: number;
      totalBytes?: number;
      currentFile?: string;
      error?: string;
      serverJobId?: string;
      throttleBps?: number;
      plan?: TransferPlan;
      currentFileBytes?: number;
      currentFileTotal?: number;
    },
  ): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    if (meta.speed !== undefined) task.speed = meta.speed;
    if (meta.etaSeconds !== undefined) task.etaSeconds = meta.etaSeconds;
    if (meta.transferredBytes !== undefined) task.transferredBytes = meta.transferredBytes;
    if (meta.totalBytes !== undefined) task.totalBytes = meta.totalBytes;
    if (meta.currentFile !== undefined) task.currentFile = meta.currentFile;
    if (meta.currentFileBytes !== undefined) task.currentFileBytes = meta.currentFileBytes;
    if (meta.currentFileTotal !== undefined) task.currentFileTotal = meta.currentFileTotal;
    if (meta.error !== undefined) task.error = meta.error;
    if (meta.serverJobId !== undefined) task.serverJobId = meta.serverJobId;
    if (meta.throttleBps !== undefined) task.throttleBps = meta.throttleBps;
    if (meta.plan !== undefined) task.plan = meta.plan;
    this.notify();
  }

  /**
   * Merges per-file progress rows into a task. Each server job reports only the
   * tail of its own work, so rows are accumulated by destination path and the
   * list is capped rather than growing one entry per file ever touched.
   */
  public updateTaskFiles(id: string, entries: FileProgressEntry[]): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || entries.length === 0) return;
    const merged = new Map((task.files || []).map((f) => [f.path, f]));
    for (const entry of entries) merged.set(entry.path, entry);
    const all = [...merged.values()];
    task.files = all.length > TaskQueueManager.FILE_WINDOW ? all.slice(all.length - TaskQueueManager.FILE_WINDOW) : all;
    this.notify();
  }

  /**
   * Marks the task whose transfer is parked on a conflict prompt. The tray reads
   * this instead of "running": the engine is waiting for an answer, not copying,
   * and a frozen progress bar with no explanation is what that used to look like.
   */
  public setWaitingForAnswer(
    jobId: string,
    waiting: boolean,
    conflict?: { source: string; destination: string },
  ): void {
    const task = this.tasks.find((t) => t.serverJobId === jobId);
    if (!task) return;
    // A second conflict of the same job arrives while the flag is already up: it still
    // has to replace the one the tray is holding, or the menu would answer the old one.
    if (Boolean(task.waitingForAnswer) === waiting && (!waiting || !conflict)) return;
    task.waitingForAnswer = waiting;
    task.pendingConflict = waiting ? (conflict ?? null) : null;
    this.notify();
  }

  public clearCompleted() {
    // Kept before the filter: the user emptying the list is the only way a task leaves
    // without running, and the plan is the whole of what a repeat replays. Dropping it
    // with the row would quietly remove the way back from a failed copy.
    this.stoppedPlan = newestRepeatablePlan(this.tasks) ?? this.stoppedPlan;
    writeStoppedPlan(this.stoppedPlan);
    this.tasks = this.tasks.filter((t) => LIVE_STATUSES.has(t.status));
    this.notify();
  }

  /**
   * The plan a repeat would replay: the newest one still in the list, or the last one
   * the user cleared. A task that arrived later is newer than anything remembered, so
   * the list always wins when it has something to offer.
   */
  public lastRepeatablePlan(): TransferPlan | undefined {
    return newestRepeatablePlan(this.tasks) ?? this.stoppedPlan;
  }

  /** A transfer that stopped keeps its plan: that is what a repeat replays, and it is
   * written out so the repeat outlives the window that ran it. */
  private rememberPlan(plan?: TransferPlan): void {
    if (!plan) return;
    this.stoppedPlan = plan;
    writeStoppedPlan(plan);
  }
}

export const taskQueue = new TaskQueueManager();
