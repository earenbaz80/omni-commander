import { describe, expect, it, afterEach } from 'vitest';
import { BackgroundTask, TransferPlan } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from './taskQueueManager';
import { resolveTrayAction, selectTrayTask, startTrayBridge, TrayCommand, TraySnapshot } from './trayBridge';

function task(id: string, status: BackgroundTask['status'], title = id): BackgroundTask {
  return {
    id,
    type: 'copy',
    title,
    progress: 0,
    status,
    createdAt: '00:00',
  };
}

describe('tray task selection', () => {
  it('controls the running transfer instead of a newer queued one', () => {
    const queued = task('queued', 'queued');
    const running = task('running', 'running');
    // The queue keeps the newest task first, so the queued one comes first here.
    expect(selectTrayTask([queued, running])?.id).toBe('running');
  });

  it('keeps a paused transfer in control until something runs again', () => {
    expect(selectTrayTask([task('queued', 'queued'), task('paused', 'paused')])?.id).toBe('paused');
  });

  it('falls back to a queued transfer only when nothing is in flight', () => {
    expect(selectTrayTask([task('done', 'completed'), task('queued', 'queued')])?.id).toBe('queued');
  });

  it('has no target when every task is finished or failed', () => {
    expect(selectTrayTask([task('a', 'completed'), task('b', 'failed')])).toBeNull();
  });
});

describe('tray command validity', () => {
  it('only pauses what is running and only resumes what is paused', () => {
    expect(resolveTrayAction(task('t', 'running'), 'pause')).toBe('pause');
    expect(resolveTrayAction(task('t', 'paused'), 'pause')).toBeNull();
    expect(resolveTrayAction(task('t', 'paused'), 'resume')).toBe('resume');
    expect(resolveTrayAction(task('t', 'running'), 'resume')).toBeNull();
  });

  it('cancels anything live and nothing that already ended', () => {
    expect(resolveTrayAction(task('t', 'running'), 'cancel')).toBe('cancel');
    expect(resolveTrayAction(task('t', 'paused'), 'cancel')).toBe('cancel');
    expect(resolveTrayAction(task('t', 'queued'), 'cancel')).toBe('cancel');
    expect(resolveTrayAction(task('t', 'completed'), 'cancel')).toBeNull();
    expect(resolveTrayAction(null, 'cancel')).toBeNull();
  });
});

describe('tray bridge', () => {
  const electron = window as unknown as { electronAPI?: unknown };
  let runningId: string | undefined;
  let stopBridge: (() => void) | undefined;

  afterEach(() => {
    stopBridge?.();
    stopBridge = undefined;
    delete electron.electronAPI;
    if (runningId) taskQueue.cancelTask(runningId);
    runningId = undefined;
    taskQueue.clearCompleted();
  });

  it('does nothing in a browser build', () => {
    const stop = startTrayBridge('en');
    expect(typeof stop).toBe('function');
    stop();
  });

  it('mirrors the live task with translated labels and applies menu commands', () => {
    const snapshots: TraySnapshot[] = [];
    let handler: ((command: TrayCommand) => void) | undefined;
    electron.electronAPI = {
      updateTrayState: (snapshot: TraySnapshot) => snapshots.push(snapshot),
      onTrayCommand: (callback: (command: TrayCommand) => void) => {
        handler = callback;
        return () => {
          handler = undefined;
        };
      },
    };

    // A task whose executor never settles stays running for the whole test.
    runningId = taskQueue.addTask('copy', 'Copy 2 items', 'C:\\dest', 2048, () => new Promise<void>(() => {}));

    const stop = startTrayBridge('es');
    stopBridge = stop;
    const first = snapshots[snapshots.length - 1];
    const es = getTranslations('es');
    expect(first.hasLiveWork).toBe(true);
    expect(first.activeCount).toBe(1);
    expect(first.task?.title).toBe('Copy 2 items');
    expect(first.labels.pause).toBe(es.bgTasksPause);
    expect(first.labels.cancel).toBe(es.btnCancel);
    expect(first.labels.dashboard).toBe(es.trayDashboard);

    handler?.('pause');
    expect(taskQueue.getTasks().find((t) => t.id === runningId)?.status).toBe('paused');
    expect(snapshots[snapshots.length - 1].task?.status).toBe('paused');

    handler?.('resume');
    expect(taskQueue.getTasks().find((t) => t.id === runningId)?.status).toBe('running');

    stop();
    expect(handler).toBeUndefined();
  });

  it('offers the last stopped transfer for a repeat and hands its plan back', () => {
    const snapshots: TraySnapshot[] = [];
    let handler: ((command: TrayCommand) => void) | undefined;
    const repeated: TransferPlan[] = [];
    electron.electronAPI = {
      updateTrayState: (snapshot: TraySnapshot) => snapshots.push(snapshot),
      onTrayCommand: (callback: (command: TrayCommand) => void) => {
        handler = callback;
        return () => {
          handler = undefined;
        };
      },
    };
    const plan: TransferPlan = {
      op: 'copy',
      sourceDriveId: 'real_C',
      targetDriveId: 'real_C',
      targetDir: 'C:\\dest',
      overwrite: false,
      collision: 'ask',
      throttleBps: 0,
      entries: [{ path: 'C:\\a.txt', name: 'a.txt', isDirectory: false, size: 10 }],
    };
    let finish = () => {};
    runningId = taskQueue.addTask(
      'copy',
      'Copy 2 items',
      'C:\\dest',
      10,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      plan,
    );
    taskQueue.cancelTask(runningId);
    stopBridge = startTrayBridge('es', (next) => repeated.push(next));

    const last = snapshots[snapshots.length - 1];
    expect(last.canRepeat).toBe(true);
    expect(last.labels.repeat).toBe(getTranslations('es').trayRepeat);

    handler?.('repeat');
    expect(repeated).toEqual([plan]);
    // The queue runs one transfer at a time; this executor is what holds it.
    finish();
  });

  it('carries the parked conflict and answers it by job id', () => {
    const snapshots: TraySnapshot[] = [];
    let handler: ((command: TrayCommand) => void) | undefined;
    const answers: Array<[string, string, boolean]> = [];
    electron.electronAPI = {
      updateTrayState: (snapshot: TraySnapshot) => snapshots.push(snapshot),
      onTrayCommand: (callback: (command: TrayCommand) => void) => {
        handler = callback;
        return () => {
          handler = undefined;
        };
      },
    };
    runningId = taskQueue.addTask('copy', 'Copy 2 items', 'C:\\dest', 10, () => new Promise<void>(() => {}));
    taskQueue.updateTaskMeta(runningId, { serverJobId: 'job_9' });
    taskQueue.setWaitingForAnswer('job_9', true, { source: 'C:\\a.txt', destination: 'D:\\dest\\a.txt' });
    stopBridge = startTrayBridge('es', undefined, (jobId, decision, applyToAll) =>
      answers.push([jobId, decision, applyToAll]),
    );

    const parked = snapshots[snapshots.length - 1];
    expect(parked.waiting).toEqual({
      id: runningId,
      jobId: 'job_9',
      title: 'Copy 2 items',
      conflict: { source: 'C:\\a.txt', destination: 'D:\\dest\\a.txt' },
    });
    // The decisions are the ones the window's prompt shows for the same answers, not
    // a second set of words for the same thing.
    const es = getTranslations('es');
    expect(parked.labels.overwrite).toBe(es.collisionOverwrite);
    expect(parked.labels.skip).toBe(es.collisionSkip);
    expect(parked.labels.rename).toBe(es.collisionRename);
    expect(parked.labels.applyAll).toBe(es.conflictAlwaysMode);

    handler?.({ resolve: 'skip', jobId: 'job_9', applyToAll: true });
    expect(answers).toEqual([['job_9', 'skip', true]]);

    // A menu left open while that job moved on answers nothing at all.
    taskQueue.setWaitingForAnswer('job_9', false);
    handler?.({ resolve: 'skip', jobId: 'job_9', applyToAll: false });
    expect(answers).toHaveLength(1);
  });

  // Last in the file: it leaves a transfer parked in the queue, and the queue runs
  // one task at a time, so a later test would find its own task still queued.
  it('says a parked transfer is waiting for an answer, and goes back when it moves', () => {
    const snapshots: TraySnapshot[] = [];
    electron.electronAPI = { updateTrayState: (snapshot: TraySnapshot) => snapshots.push(snapshot) };
    runningId = taskQueue.addTask('copy', 'Copy 2 items', 'C:\\dest', 2048, () => new Promise<void>(() => {}));
    taskQueue.updateTaskMeta(runningId, { serverJobId: 'job_9' });
    stopBridge = startTrayBridge('es');

    // Whether this task is running or still queued behind the previous one is the
    // queue's business; the flag is what the tray has to respect.
    const ownStatus = taskQueue.getTasks().find((t) => t.id === runningId)?.status;

    taskQueue.setWaitingForAnswer('job_9', true);
    const parked = snapshots[snapshots.length - 1];
    expect(parked.task?.status).toBe('waiting');
    expect(parked.labels.waiting).toBe(getTranslations('es').trayWaiting);
    // The tray names the job that needs the user on its own field, so the menu row
    // can lead to it without guessing from the selection.
    expect(parked.waiting).toEqual({ id: runningId, jobId: 'job_9', title: 'Copy 2 items', conflict: null });
    expect(parked.labels.answer).toBe(getTranslations('es').trayAnswer);

    taskQueue.setWaitingForAnswer('job_9', false);
    expect(snapshots[snapshots.length - 1].task?.status).toBe(ownStatus);
    expect(snapshots[snapshots.length - 1].waiting).toBeNull();
  });
});
