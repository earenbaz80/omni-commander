import { BackgroundTask, LanguageCode, TransferPlan } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from './taskQueueManager';

export type ConflictDecision = 'overwrite' | 'skip' | 'rename' | 'cancel';

export type TrayCommand =
  | 'resume'
  | 'pause'
  | 'cancel'
  | 'repeat'
  /** An answer to the conflict the menu was showing; the job travels with it. */
  | { resolve: ConflictDecision; jobId: string; applyToAll: boolean };
export type TrayAction = 'pause' | 'resume' | 'cancel';
export type TrayTaskStatus = 'running' | 'paused' | 'queued' | 'waiting';

/** A transfer the engine is holding open until someone answers its conflict. */
export interface TrayWaiting {
  id: string;
  /** The server job the answer has to reach. */
  jobId: string;
  title: string;
  conflict: { source: string; destination: string; expiresInMs?: number } | null;
}

/** The bounded snapshot the tray is allowed to know about. */
export interface TraySnapshot {
  hasLiveWork: boolean;
  activeCount: number;
  /** A stopped transfer kept its plan, so the tray can queue it again. */
  canRepeat: boolean;
  /**
   * The transfers the engine is holding open for an answer, newest first. None of
   * them is necessarily the selected one -- that is chosen for the controls -- and
   * the tray answers each on a row of its own, so carrying only one left the others
   * to run out their deadline unannounced.
   */
  waiting: TrayWaiting[];
  task: {
    id: string;
    title: string;
    status: TrayTaskStatus;
    progress: number;
    /** Formatted rate, so the tooltip can say whether a hidden transfer moves. */
    speed?: string;
    etaSeconds?: number;
  } | null;
  labels: {
    resume: string;
    pause: string;
    cancel: string;
    dashboard: string;
    waiting: string;
    answer: string;
    overwrite: string;
    skip: string;
    rename: string;
    applyAll: string;
    repeat: string;
    quit: string;
  };
}

interface ElectronTrayBridge {
  updateTrayState?: (snapshot: TraySnapshot) => void;
  onTrayCommand?: (callback: (command: TrayCommand) => void) => (() => void) | void;
}

/**
 * Statuses the tray can act on. A failed or finished transfer has no control
 * worth offering, so it stays out of the tray entirely.
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'paused', 'queued', 'waiting']);

export function isLiveTask(task: BackgroundTask): boolean {
  return LIVE_STATUSES.has(task.status);
}

/**
 * Picks the transfer the tray menu controls.
 *
 * A queued task is newer than the one running, and the queue is newest-first, so
 * taking the first live task would hand the pause button to something that has
 * not started. The running transfer wins; when it is paused it keeps control;
 * only when nothing is in flight does a queued task become the target.
 */
export function selectTrayTask(tasks: BackgroundTask[]): BackgroundTask | null {
  return (
    tasks.find((task) => task.status === 'running') ??
    tasks.find((task) => task.status === 'paused') ??
    tasks.find((task) => task.status === 'queued') ??
    null
  );
}

/**
 * Maps a tray command to the action that is actually valid for the selected
 * task, so a stale menu (a click that lands after the transfer moved on) does
 * nothing instead of, say, "resuming" a task that is already running.
 */
export function resolveTrayAction(task: BackgroundTask | null, command: TrayCommand): TrayAction | null {
  if (!task) return null;
  if (command === 'pause') return task.status === 'running' ? 'pause' : null;
  if (command === 'resume') return task.status === 'paused' ? 'resume' : null;
  if (command === 'cancel') return isLiveTask(task) ? 'cancel' : null;
  return null;
}

function bridge(): ElectronTrayBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: ElectronTrayBridge }).electronAPI;
}

/**
 * Keeps the Electron tray in step with the task queue and applies the menu's
 * picks to it. Returns a teardown function; in a browser build there is nothing
 * to attach to and the returned function is a no-op.
 */
export function startTrayBridge(
  lang: LanguageCode,
  onRepeat?: (plan: TransferPlan) => void,
  onAnswer?: (jobId: string, decision: ConflictDecision, applyToAll: boolean) => void,
): () => void {
  const api = bridge();
  if (!api?.updateTrayState) return () => {};
  const updateTrayState = api.updateTrayState;
  const t = getTranslations(lang);

  // A parked transfer is the one case with nothing to report but the clock: the
  // engine waits for an answer, no progress arrives, and the queue's own
  // notifications stop. Without a second read the tray would keep the seconds it
  // was handed at the moment of parking, so the wait is followed here instead.
  let clock: ReturnType<typeof setInterval> | undefined;
  const followClock = (parked: boolean) => {
    if (parked && clock === undefined) clock = setInterval(sync, 1000);
    else if (!parked && clock !== undefined) {
      clearInterval(clock);
      clock = undefined;
    }
  };

  const sync = () => {
    const tasks = taskQueue.getTasks();
    const liveTasks = tasks.filter(isLiveTask);
    const task = selectTrayTask(tasks);
    const waiting: TrayWaiting[] = tasks
      .filter((entry) => entry.waitingForAnswer && isLiveTask(entry))
      .map((entry) => ({
        id: entry.id,
        jobId: entry.serverJobId ?? '',
        title: entry.title,
        conflict: entry.pendingConflict ?? null,
      }));
    updateTrayState({
      hasLiveWork: liveTasks.length > 0,
      activeCount: liveTasks.length,
      canRepeat: taskQueue.lastRepeatablePlan() !== undefined,
      waiting,
      task:
        task && isLiveTask(task)
          ? {
              id: task.id,
              title: task.title,
              // A parked transfer is still `running` in the queue: the engine, not
              // the queue, is the one waiting for an answer. The parks found above
              // are what say so, so the flag is not read a second time here.
              status: (waiting.some((park) => park.id === task.id) ? 'waiting' : task.status) as TrayTaskStatus,
              progress: task.progress,
              speed: task.speed,
              etaSeconds: task.etaSeconds,
            }
          : null,
      labels: {
        resume: t.bgTasksResume,
        pause: t.bgTasksPause,
        cancel: t.btnCancel,
        // The tray is the one place the main process can hand over the engine
        // page's URL: it holds both the port and the token there.
        dashboard: t.trayDashboard,
        waiting: t.trayWaiting,
        answer: t.trayAnswer,
        // The same words the window's prompt uses for the same answers, so a
        // decision means one thing wherever it is made.
        overwrite: t.collisionOverwrite,
        skip: t.collisionSkip,
        rename: t.collisionRename,
        applyAll: t.conflictAlwaysMode,
        repeat: t.trayRepeat,
        quit: t.quitDialogLabel,
      },
    });
    // Only while something is parked with a clock to read: a running transfer
    // reports itself, and a park without a deadline has nothing to count down.
    followClock(waiting.some((park) => park.conflict?.expiresInMs !== undefined));
  };

  const handleCommand = (command: TrayCommand) => {
    if (typeof command === 'object' && command) {
      // The menu answered the conflict it was showing. A menu left open while that
      // job moved on must not answer whatever is parked next in its place.
      const task = taskQueue.getTasks().find((entry) => entry.serverJobId === command.jobId);
      if (!task?.waitingForAnswer) return;
      onAnswer?.(command.jobId, command.resolve, command.applyToAll);
      return;
    }
    // A stopped transfer is not the selected one -- the tray controls live work -- so
    // its command carries its own target instead of going through the selection.
    if (command === 'repeat') {
      const plan = taskQueue.lastRepeatablePlan();
      if (plan) onRepeat?.(plan);
      return;
    }
    const task = selectTrayTask(taskQueue.getTasks());
    const action = resolveTrayAction(task, command);
    if (!task || !action) return;
    if (action === 'resume') taskQueue.resumeTask(task.id);
    else if (action === 'pause') taskQueue.pauseTask(task.id);
    else taskQueue.cancelTask(task.id);
  };

  const unsubscribeQueue = taskQueue.subscribe(sync);
  const unsubscribeCommand = api.onTrayCommand?.(handleCommand);
  sync();

  return () => {
    if (clock !== undefined) clearInterval(clock);
    unsubscribeQueue();
    if (typeof unsubscribeCommand === 'function') unsubscribeCommand();
  };
}
