import { BackgroundTask, LanguageCode, TransferPlan } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from './taskQueueManager';
import { lastRepeatablePlan } from './taskRepeat';

export type TrayCommand = 'resume' | 'pause' | 'cancel' | 'repeat';
export type TrayAction = 'pause' | 'resume' | 'cancel';
export type TrayTaskStatus = 'running' | 'paused' | 'queued' | 'waiting';

/** The bounded snapshot the tray is allowed to know about. */
export interface TraySnapshot {
  hasLiveWork: boolean;
  activeCount: number;
  /** A stopped transfer kept its plan, so the tray can queue it again. */
  canRepeat: boolean;
  /**
   * The transfer the engine is holding open for an answer. It is not always the
   * selected one -- that is chosen for the controls -- but it is the only one the
   * user has to act on.
   */
  waiting: {
    id: string;
    /** The server job the answer has to reach. */
    jobId: string;
    title: string;
    conflict: { source: string; destination: string } | null;
  } | null;
  task: {
    id: string;
    title: string;
    status: TrayTaskStatus;
    progress: number;
  } | null;
  labels: {
    resume: string;
    pause: string;
    cancel: string;
    dashboard: string;
    waiting: string;
    answer: string;
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
export function startTrayBridge(lang: LanguageCode, onRepeat?: (plan: TransferPlan) => void): () => void {
  const api = bridge();
  if (!api?.updateTrayState) return () => {};
  const updateTrayState = api.updateTrayState;
  const t = getTranslations(lang);

  const sync = () => {
    const tasks = taskQueue.getTasks();
    const liveTasks = tasks.filter(isLiveTask);
    const task = selectTrayTask(tasks);
    const waiting = tasks.find((entry) => entry.waitingForAnswer && isLiveTask(entry));
    updateTrayState({
      hasLiveWork: liveTasks.length > 0,
      activeCount: liveTasks.length,
      canRepeat: lastRepeatablePlan(tasks) !== undefined,
      waiting: waiting
        ? {
            id: waiting.id,
            jobId: waiting.serverJobId ?? '',
            title: waiting.title,
            conflict: waiting.pendingConflict ?? null,
          }
        : null,
      task:
        task && isLiveTask(task)
          ? {
              id: task.id,
              title: task.title,
              // A parked transfer is still `running` in the queue: the engine, not
              // the queue, is the one waiting for an answer. The wait found above is
              // what says so, so the flag is not read a second time here.
              status: (waiting?.id === task.id ? 'waiting' : task.status) as TrayTaskStatus,
              progress: task.progress,
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
        repeat: t.trayRepeat,
        quit: t.quitDialogLabel,
      },
    });
  };

  const handleCommand = (command: TrayCommand) => {
    // A stopped transfer is not the selected one -- the tray controls live work -- so
    // its command carries its own target instead of going through the selection.
    if (command === 'repeat') {
      const plan = lastRepeatablePlan(taskQueue.getTasks());
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
    unsubscribeQueue();
    if (typeof unsubscribeCommand === 'function') unsubscribeCommand();
  };
}
