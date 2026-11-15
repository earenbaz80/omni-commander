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

  const parked = (
    jobId: string,
    executor: () => Promise<void>,
    conflict?: { source: string; destination: string; expiresInMs?: number },
  ) => {
    const id = taskQueue.addTask('copy', 'Copy 2 items', 'T:\\dest', 10, executor);
    taskQueue.updateTaskMeta(id, { serverJobId: jobId });
    taskQueue.setWaitingForAnswer(jobId, true, conflict);
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

  it('holds the conflict the tray is answering until the flag comes down', async () => {
    const gate = hold();
    const id = parked('job_conflict', gate.run);

    taskQueue.setWaitingForAnswer('job_conflict', true, { source: 'C:\\a.txt', destination: 'D:\\a.txt' });
    expect(taskById(id).pendingConflict).toEqual({ source: 'C:\\a.txt', destination: 'D:\\a.txt' });

    taskQueue.setWaitingForAnswer('job_conflict', false);
    expect(taskById(id).pendingConflict).toBeNull();

    gate.release();
    await vi.waitFor(() => expect(taskById(id).status).toBe('completed'));
  });

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

  it('counts the parked clock down between two readings instead of repeating the value it was handed', async () => {
    // The tray reads this field while the job is parked, and nothing else reports
    // progress during that wait. The conflict arrives once, with the seconds left at
    // that instant; handing that same number to every read is what left the menu
    // saying 5:00 until the engine gave up on the transfer.
    const gate = hold();
    const now = vi.spyOn(Date, 'now');
    let id: string | undefined;
    try {
      now.mockReturnValue(Date.parse('2026-11-14T09:00:00Z'));
      id = taskQueue.addTask('copy', 'Copy 2 items', 'T:\\dest', 10, gate.run);
      taskQueue.updateTaskMeta(id, { serverJobId: 'job_clock' });
      taskQueue.setWaitingForAnswer('job_clock', true, {
        source: 'C:\\a.txt',
        destination: 'D:\\a.txt',
        expiresInMs: 300_000,
      });

      const first = taskById(id).pendingConflict?.expiresInMs;
      expect(first).toBe(300_000);

      // Three seconds of wall clock, which is the same gap the tray reads across.
      now.mockReturnValue(Date.parse('2026-11-14T09:00:03Z'));
      const second = taskById(id).pendingConflict?.expiresInMs;

      expect(second).toBe(297_000);
      expect(second!).toBeLessThan(first!);

      // The wait ends when the deadline passes: the clock stops at zero instead of
      // counting into time the engine no longer grants.
      now.mockReturnValue(Date.parse('2026-11-14T09:05:03Z'));
      expect(taskById(id).pendingConflict?.expiresInMs).toBe(0);
    } finally {
      now.mockRestore();
      gate.release();
    }

    // The queue runs one transfer at a time: this one has to finish before the next
    // test can park its own.
    await vi.waitFor(() => expect(taskById(id!).status).toBe('completed'));
  });

  it('gives each parked job its own deadline instead of sharing one', async () => {
    // The tray can carry two parks at once, and the engine grants each wait its own
    // minutes. The queue runs one transfer at a time, so this state is built as
    // data; the point is that the clock stays per job rather than per queue. One
    // clock for the queue would hand the second job the first one's seconds -- a
    // wait nobody was promised -- and would stop counting for the first as soon as
    // they met.
    const firstGate = hold();
    const secondGate = hold();
    const now = vi.spyOn(Date, 'now');
    // What the tray reads while a job is parked.
    const leftOf = (id: string) => taskById(id).pendingConflict?.expiresInMs;
    let firstId: string | undefined;
    let secondId: string | undefined;
    try {
      now.mockReturnValue(Date.parse('2026-11-14T09:00:00Z'));
      firstId = parked('job_a', firstGate.run, {
        source: 'C:\\a.txt',
        destination: 'D:\\a.txt',
        expiresInMs: 300_000,
      });

      // Half a minute later the second job parks with the two minutes it was given,
      // not with the five the other one started with.
      now.mockReturnValue(Date.parse('2026-11-14T09:00:30Z'));
      secondId = parked('job_b', secondGate.run, {
        source: 'C:\\b.txt',
        destination: 'E:\\b.txt',
        expiresInMs: 120_000,
      });

      now.mockReturnValue(Date.parse('2026-11-14T09:00:40Z'));
      expect(leftOf(firstId)).toBe(260_000);
      expect(leftOf(secondId)).toBe(110_000);

      // A read of each five seconds later: neither clock is frozen on the number the
      // read before it returned, and neither was restarted by being read.
      now.mockReturnValue(Date.parse('2026-11-14T09:00:45Z'));
      expect(leftOf(firstId)).toBe(255_000);
      expect(leftOf(secondId)).toBe(105_000);
    } finally {
      now.mockRestore();
      firstGate.release();
      secondGate.release();
    }

    await vi.waitFor(() => expect(taskById(firstId!).status).toBe('completed'));
    await vi.waitFor(() => expect(taskById(secondId!).status).toBe('completed'));
  });

  it('restarts the wait when the same job parks on a second conflict', async () => {
    // Answering one collision can land the job on the next file, which arrives as
    // a second conflict for the same job. The clock has to follow that one, not
    // keep the time left over from the first.
    const gate = hold();
    const now = vi.spyOn(Date, 'now');
    let id: string | undefined;
    try {
      now.mockReturnValue(Date.parse('2026-11-14T09:00:00Z'));
      id = taskQueue.addTask('copy', 'Copy 2 items', 'T:\\dest', 10, gate.run);
      taskQueue.updateTaskMeta(id, { serverJobId: 'job_again' });
      taskQueue.setWaitingForAnswer('job_again', true, {
        source: 'C:\\a.txt',
        destination: 'D:\\a.txt',
        expiresInMs: 300_000,
      });

      now.mockReturnValue(Date.parse('2026-11-14T09:00:10Z'));
      taskQueue.setWaitingForAnswer('job_again', true, {
        source: 'C:\\b.txt',
        destination: 'D:\\b.txt',
        expiresInMs: 60_000,
      });

      expect(taskById(id).pendingConflict?.destination).toBe('D:\\b.txt');
      expect(taskById(id).pendingConflict?.expiresInMs).toBe(60_000);
    } finally {
      now.mockRestore();
      gate.release();
    }

    await vi.waitFor(() => expect(taskById(id!).status).toBe('completed'));
  });

  it('cannot start a second transfer while the first is parked on an answer', async () => {
    // The tray draws one row per park, but the queue reaches that state only if two
    // executors run at once. It runs one: the loop is held inside the parked
    // executor, so the next queued transfer never starts and never asks for an
    // answer of its own. This is why the two-row menu cannot be produced from the
    // window itself, and why the tray tests build the two parks as data.
    const gate = hold();
    let firstParked = false;
    const firstId = taskQueue.addTask('copy', 'Copy 1', 'T:\\dest', 10, async () => {
      // The engine reports the park once it is running, which is after addTask has
      // returned and the job id has been attached to the task.
      await new Promise((resolve) => setTimeout(resolve, 0));
      firstParked = true;
      taskQueue.setWaitingForAnswer('job_first', true, {
        source: 'C:\\a.txt',
        destination: 'D:\\a.txt',
        expiresInMs: 300_000,
      });
      await gate.run();
    });
    taskQueue.updateTaskMeta(firstId, { serverJobId: 'job_first' });

    const secondRun = vi.fn(async () => {
      taskQueue.setWaitingForAnswer('job_second', true, {
        source: 'C:\\b.txt',
        destination: 'D:\\b.txt',
        expiresInMs: 120_000,
      });
    });
    const secondId = taskQueue.addTask('copy', 'Copy 2', 'T:\\dest', 10, secondRun);
    taskQueue.updateTaskMeta(secondId, { serverJobId: 'job_second' });

    await vi.waitFor(() => expect(firstParked).toBe(true));
    expect(taskById(firstId).status).toBe('running');
    expect(taskById(secondId).status).toBe('queued');
    expect(secondRun).not.toHaveBeenCalled();
    expect(taskQueue.getTasks().filter((task) => task.waitingForAnswer)).toHaveLength(1);

    gate.release();
    await vi.waitFor(() => expect(taskById(firstId).status).toBe('completed'));
    await vi.waitFor(() => expect(taskById(secondId).status).toBe('completed'));
  });

  it('stops waiting when the transfer completes with the prompt still open', async () => {
    // A conflict answered from the dashboard never passes through the renderer
    // that closes the prompt, so the flag can outlive the job it belonged to.
    const gate = hold();
    const id = parked('job_done', gate.run);

    gate.release();
    await vi.waitFor(() => expect(taskById(id).status).toBe('completed'));
    expect(taskById(id).waitingForAnswer).toBe(false);
    // The conflict goes with it. Kept, it would be read without its deadline and
    // report the full wait it was handed, a 5:00 that nobody is waiting on.
    expect(taskById(id).pendingConflict).toBeNull();
  });
});
