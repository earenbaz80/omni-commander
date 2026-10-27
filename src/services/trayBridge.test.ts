import { describe, expect, it, afterEach } from 'vitest';
import { BackgroundTask } from '../types';
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

    handler?.('pause');
    expect(taskQueue.getTasks().find((t) => t.id === runningId)?.status).toBe('paused');
    expect(snapshots[snapshots.length - 1].task?.status).toBe('paused');

    handler?.('resume');
    expect(taskQueue.getTasks().find((t) => t.id === runningId)?.status).toBe('running');

    stop();
    expect(handler).toBeUndefined();
  });
});
