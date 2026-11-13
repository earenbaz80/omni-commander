// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { taskQueue } from './taskQueueManager';
import { FileProgressEntry, TransferPlan } from '../types';

/**
 * The transfer engine reports only the tail of the files it touched, once per
 * poll and once per item, so the queue owns the accumulation. These tests pin
 * that down: rows must merge by destination instead of duplicating, and the
 * list must stay bounded because a transfer can touch hundreds of thousands of
 * files.
 */

const row = (path: string, status: FileProgressEntry['status'], copied = 0, size = 100): FileProgressEntry => ({
  path,
  name: path.split('\\').pop() || path,
  size,
  copied,
  status,
});

const taskById = (id: string) => taskQueue.getTasks().find((t) => t.id === id)!;

describe('taskQueue per-file progress', () => {
  beforeEach(() => {
    taskQueue.clearCompleted();
  });

  it('accumulates rows reported by separate jobs under one task', () => {
    const id = taskQueue.addTask('copy', 'Copy 2 items', undefined, 200);

    taskQueue.updateTaskFiles(id, [row('T:\\dest\\a.txt', 'copying')]);
    taskQueue.updateTaskFiles(id, [row('T:\\dest\\b.txt', 'copying')]);

    expect(taskById(id).files!.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('merges by destination path instead of duplicating a row', () => {
    const id = taskQueue.addTask('copy', 'Copy 1 item', undefined, 100);

    taskQueue.updateTaskFiles(id, [row('T:\\dest\\a.txt', 'copying', 10)]);
    taskQueue.updateTaskFiles(id, [row('T:\\dest\\a.txt', 'done', 100)]);

    const files = taskById(id).files!;
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('done');
    expect(files[0].copied).toBe(100);
  });

  it('keeps a bounded window rather than one row per file ever touched', () => {
    const id = taskQueue.addTask('copy', 'Copy many', undefined, 1000);

    for (let i = 0; i < 120; i++) {
      taskQueue.updateTaskFiles(id, [row(`T:\\dest\\f${i}.txt`, 'done', 100)]);
    }

    const files = taskById(id).files!;
    expect(files.length).toBeLessThan(120);
    expect(files[0].name).toBe('f60.txt');
    expect(files[files.length - 1].name).toBe('f119.txt');
  });

  it('ignores an unknown task id and an empty batch', () => {
    const id = taskQueue.addTask('copy', 'Copy 1 item', undefined, 100);

    taskQueue.updateTaskFiles('task_missing', [row('T:\\dest\\a.txt', 'done')]);
    taskQueue.updateTaskFiles(id, []);

    expect(taskById(id).files).toBeUndefined();
  });

  it('exposes only planned transfers, oldest first, for the copy list', () => {
    const copyPlan: TransferPlan = {
      op: 'copy',
      sourceDriveId: 'real_T',
      targetDriveId: 'real_T',
      targetDir: 'T:\\dest',
      overwrite: true,
      collision: 'overwrite',
      throttleBps: 0,
      entries: [{ path: 'T:\\a.txt', name: 'a', isDirectory: false, size: 1 }],
    };
    const movePlan: TransferPlan = { ...copyPlan, op: 'move', targetDir: 'T:\\otro' };

    taskQueue.addTask('copy', 'Copy 1', undefined, 1, undefined, copyPlan);
    // A delete moves no bytes and cannot be replayed from a saved list.
    taskQueue.addTask('delete', 'Delete 1', undefined, 1);
    taskQueue.addTask('move', 'Move 1', undefined, 1, undefined, movePlan);

    expect(taskQueue.getPlans()).toEqual([copyPlan, movePlan]);
  });

  it('returns no plans at all when nothing reproducible was queued', () => {
    taskQueue.addTask('delete', 'Delete 3', undefined, 3);

    expect(taskQueue.getPlans()).toEqual([]);
  });

  it('hands a running executor the plan as it is now, not as it started', () => {
    const copyPlan: TransferPlan = {
      op: 'copy',
      sourceDriveId: 'real_T',
      targetDriveId: 'real_T',
      targetDir: 'T:\\dest',
      overwrite: true,
      collision: 'overwrite',
      throttleBps: 0,
      entries: [{ path: 'T:\\a.txt', name: 'a', isDirectory: false, size: 1 }],
    };
    const id = taskQueue.addTask('copy', 'Copy 1', undefined, 1, undefined, copyPlan);

    // The transfer window appends a picked file while the job is in flight.
    const extended: TransferPlan = {
      ...copyPlan,
      entries: [...copyPlan.entries, { path: 'T:\\b.txt', name: 'b', isDirectory: false, size: 2 }],
    };
    taskQueue.updateTaskMeta(id, { plan: extended });

    expect(taskQueue.getPlan(id)).toBe(extended);
    expect(taskQueue.getPlan('task_missing')).toBeUndefined();
  });
});

/**
 * A transfer parked on a conflict can end unanswered: cancelled elsewhere, or the
 * engine giving up. The plan stays for a repeat; waiting for an answer must not.
 */
describe('taskQueue and a conflict left unanswered', () => {
  beforeEach(() => {
    for (const task of taskQueue.getTasks()) taskQueue.cancelTask(task.id);
    taskQueue.clearCompleted();
  });

  const parked = (jobId: string, executor: () => Promise<void>) => {
    const id = taskQueue.addTask('copy', 'Copy 2 items', 'T:\\dest', 10, executor);
    taskQueue.updateTaskMeta(id, { serverJobId: jobId });
    taskQueue.setWaitingForAnswer(jobId, true);
    return id;
  };

  // An executor that holds the queue until the test lets it go, which is what a
  // transfer parked on a prompt looks like from the queue's side.
  const hold = () => {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    // `release` already holds the resolver: the promise is built before it is
    // returned, so nothing has to look the current value up again.
    return { run: () => promise, release };
  };

  it('keeps waiting while the transfer is still alive', async () => {
    // The tray reads this flag instead of "running", so a sweep that cleared it
    // unconditionally would take the prompt off the tray while the engine waits.
    const gate = hold();
    const id = parked('job_live', gate.run);

    taskQueue.updateTaskMeta(id, { speed: '1.0 MB/s' });
    expect(taskById(id).waitingForAnswer).toBe(true);

    taskQueue.pauseTask(id);
    taskQueue.updateTaskMeta(id, { speed: '1.0 MB/s' });
    expect(taskById(id).status).toBe('paused');
    expect(taskById(id).waitingForAnswer).toBe(true);

    // A paused executor never finishes on its own, so the queue would keep it.
    taskQueue.resumeTask(id);
    gate.release();
  });

  it('stops waiting when the transfer is cancelled from somewhere else', async () => {
    const gate = hold();
    const id = parked('job_cancel', gate.run);
    expect(taskById(id).waitingForAnswer).toBe(true);

    taskQueue.cancelTask(id);

    expect(taskById(id).status).toBe('cancelled');
    expect(taskById(id).waitingForAnswer).toBe(false);

    // The queue runs one transfer at a time and this executor is what holds it.
    gate.release();
  });

  it('stops waiting when the engine gives up and the transfer fails', async () => {
    const id = parked('job_fail', async () => {
      throw new Error('conflict left unanswered');
    });

    await vi.waitFor(() => expect(taskById(id).status).toBe('failed'));
    expect(taskById(id).waitingForAnswer).toBe(false);
  });

  it('stops waiting when the transfer completes with the prompt still open', async () => {
    // A conflict answered from the dashboard never passes through the renderer
    // that closes the prompt, so the flag can outlive the job it belonged to.
    const gate = hold();
    const id = parked('job_done', gate.run);

    gate.release();
    await vi.waitFor(() => expect(taskById(id).status).toBe('completed'));
    expect(taskById(id).waitingForAnswer).toBe(false);
  });
});
