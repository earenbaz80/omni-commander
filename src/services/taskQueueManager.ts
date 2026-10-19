import { BackgroundTask, FileProgressEntry, TransferPlan } from '../types';

export interface OperationSignal {
  paused: boolean;
  cancelled: boolean;
}

export type ProgressCallback = (transferred: number, total: number) => void;
export type OperationExecutor = (
  onProgress: ProgressCallback,
  signal: OperationSignal
) => Promise<void>;

class TaskQueueManager {
  /**
   * How many per-file rows a task keeps. The engine reports each job's tail, and
   * a transfer can touch hundreds of thousands of files, so the merged list is
   * capped to what a human could actually read.
   */
  private static readonly FILE_WINDOW = 60;

  private tasks: BackgroundTask[] = [];
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
    return this.tasks.filter(t => t.status === 'running' || t.status === 'queued').length;
  }

  /**
   * The planned transfers behind the queue, oldest first, which is the order a
   * saved copy list replays in. Tasks without a plan (delete, archive) have no
   * reproducible batch and are skipped.
   */
  public getPlans(): TransferPlan[] {
    return this.tasks
      .filter((task): task is BackgroundTask & { plan: TransferPlan } => !!task.plan)
      .map(task => task.plan)
      .reverse();
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public addTask(
    type: BackgroundTask['type'],
    title: string,
    details?: string,
    totalBytes?: number,
    executor?: OperationExecutor,
    plan?: TransferPlan
  ): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newTask: BackgroundTask = {
      id,
      type,
      title,
      details,
      progress: 0,
      status: 'queued',
      speed: '0 MB/s',
      transferredBytes: 0,
      totalBytes: totalBytes || 1024 * 1024,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      plan
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
        const task = this.tasks.find(t => t.status === 'queued');
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
              const speed = ((transferred - lastTransferred) / elapsed / (1024 * 1024)).toFixed(1);
              task.speed = speed + ' MB/s';
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
        } catch (e: any) {
          if (!signal.cancelled) {
            task.status = 'failed';
            task.error = e?.message || 'Unknown error';
            this.notify();
          }
        }

        if (signal.cancelled) {
          task.status = 'cancelled';
          task.progress = 0;
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
    const task = this.tasks.find(t => t.id === id);
    if (task && task.status === 'running') {
      task.status = 'paused';
      const signal = this.signals.get(id);
      if (signal) signal.paused = true;
      this.notify();
    }
  }

  public resumeTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task && task.status === 'paused') {
      task.status = 'running';
      const signal = this.signals.get(id);
      if (signal) signal.paused = false;
      this.notify();
    }
  }

  public cancelTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = 'cancelled';
      const signal = this.signals.get(id);
      if (signal) signal.cancelled = true;
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
    }
  ): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return;
    if (meta.speed !== undefined) task.speed = meta.speed;
    if (meta.etaSeconds !== undefined) task.etaSeconds = meta.etaSeconds;
    if (meta.transferredBytes !== undefined) task.transferredBytes = meta.transferredBytes;
    if (meta.totalBytes !== undefined) task.totalBytes = meta.totalBytes;
    if (meta.currentFile !== undefined) task.currentFile = meta.currentFile;
    if (meta.error !== undefined) task.error = meta.error;
    this.notify();
  }

  /**
   * Merges per-file progress rows into a task. Each server job reports only the
   * tail of its own work, so rows are accumulated by destination path and the
   * list is capped rather than growing one entry per file ever touched.
   */
  public updateTaskFiles(id: string, entries: FileProgressEntry[]): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task || entries.length === 0) return;
    const merged = new Map((task.files || []).map(f => [f.path, f]));
    for (const entry of entries) merged.set(entry.path, entry);
    const all = [...merged.values()];
    task.files =
      all.length > TaskQueueManager.FILE_WINDOW
        ? all.slice(all.length - TaskQueueManager.FILE_WINDOW)
        : all;
    this.notify();
  }

  public clearCompleted() {
    this.tasks = this.tasks.filter(t => t.status === 'running' || t.status === 'queued' || t.status === 'paused');
    this.notify();
  }
}

export const taskQueue = new TaskQueueManager();