import { describe, it, expect, beforeEach } from 'vitest';
import { taskQueue } from './taskQueueManager';
import { FileProgressEntry } from '../types';

/**
 * The transfer engine reports only the tail of the files it touched, once per
 * poll and once per item, so the queue owns the accumulation. These tests pin
 * that down: rows must merge by destination instead of duplicating, and the
 * list must stay bounded because a transfer can touch hundreds of thousands of
 * files.
 */

const row = (
  path: string,
  status: FileProgressEntry['status'],
  copied = 0,
  size = 100
): FileProgressEntry => ({
  path,
  name: path.split('\\').pop() || path,
  size,
  copied,
  status
});

const taskById = (id: string) => taskQueue.getTasks().find(t => t.id === id)!;

describe('taskQueue per-file progress', () => {
  beforeEach(() => {
    taskQueue.clearCompleted();
  });

  it('accumulates rows reported by separate jobs under one task', () => {
    const id = taskQueue.addTask('copy', 'Copy 2 items', undefined, 200);

    taskQueue.updateTaskFiles(id, [row('T:\\dest\\a.txt', 'copying')]);
    taskQueue.updateTaskFiles(id, [row('T:\\dest\\b.txt', 'copying')]);

    expect(taskById(id).files!.map(f => f.name)).toEqual(['a.txt', 'b.txt']);
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
});
