// @vitest-environment node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Copying *onto* a folder that is already there.
 *
 * `mkdir` on an existing directory succeeds on Windows with some code paths and
 * fails with another, and the drive root is the case that bites: `mkdir('E:\\')`
 * answers EPERM even though the drive exists, so a copy aimed at a root used to
 * die in milliseconds with nothing written. The engine is now asked to create a
 * destination only when it is missing, and this file drives a real copy through
 * it with every existing directory refusing to be created again, which is what
 * a root does.
 *
 * The refusal is installed for the test because writing to a real drive root
 * needs administrator rights and would leave files on the user's disk.
 */

const require = createRequire(import.meta.url);

interface Entry {
  path: string;
  size: number;
  copied: number;
  status: string;
}

interface Job {
  id: string;
  op: string;
  collision?: string;
  status?: string;
  paused?: boolean;
  cancelled?: boolean;
  pendingConflict?: { destination?: string; expiresInMs?: number } | null;
  resumeExisting?: boolean;
  items: Entry[];
  errors: { path: string; message: string }[];
  copiedBytes: number;
  itemsDone: number;
  itemsSkipped: number;
  itemsTotal: number;
  totalBytes: number;
  currentFile: string;
  force: boolean;
}

interface FileOps {
  ensureDirectory: (dir: string) => Promise<void>;
  runTransferJob: (job: Job, sources: string[], targetDir: string) => Promise<void>;
}

const { createFileOps } = require('./server/fileOps.cjs') as {
  createFileOps: (deps: Record<string, unknown>) => FileOps;
};
const { conflictNotice } = require('./electron/jobNotices.cjs') as {
  conflictNotice: (job: Job) => { title: string; body: string } | null;
};

const scratchDirs: string[] = [];

function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (scratchDirs.length > 0) {
    fs.rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeOps(extra: Record<string, unknown> = {}): FileOps {
  return createFileOps({
    noteFile: (job: Job, target: string, size: number) => {
      const entry: Entry = { path: target, size, copied: 0, status: 'pending' };
      job.items.push(entry);
      return entry;
    },
    waitWhilePaused: async () => undefined,
    sleep: async () => undefined,
    finishJob: () => undefined,
    ...extra,
  }) as FileOps;
}

function makeJob(): Job {
  return {
    id: 'job-root-test',
    op: 'copy',
    items: [],
    errors: [],
    copiedBytes: 0,
    itemsDone: 0,
    itemsSkipped: 0,
    itemsTotal: 0,
    totalBytes: 0,
    currentFile: '',
    force: false,
  };
}

/** Makes `mkdir` answer the way a drive root does: EPERM for anything existing. */
function refuseCreatingExistingDirectories(): () => void {
  const realMkdir = fs.promises.mkdir.bind(fs.promises);
  const simulated = (async (dir: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
    if (fs.existsSync(dir)) {
      const error = new Error(`EPERM: operation not permitted, mkdir '${String(dir)}'`) as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    }
    return realMkdir(dir, options);
  }) as typeof fs.promises.mkdir;

  fs.promises.mkdir = simulated;
  return () => {
    fs.promises.mkdir = realMkdir;
  };
}

describe('copying onto a folder that already exists', () => {
  it('never asks to create a destination that is already there', async () => {
    const source = scratch('omni-root-src-');
    const target = scratch('omni-root-dst-');
    fs.mkdirSync(path.join(source, 'sub'));
    fs.writeFileSync(path.join(source, 'sub', 'nota.txt'), 'hola\n', 'utf8');
    fs.writeFileSync(path.join(source, 'raiz.txt'), 'raiz\n', 'utf8');

    const restore = refuseCreatingExistingDirectories();
    try {
      // The simulation has to be live for the same `fs` the engine reads, or the
      // copy below would prove nothing about the refusal it is meant to survive.
      await expect(fs.promises.mkdir(target, { recursive: true })).rejects.toThrow(/EPERM/);

      const job = makeJob();
      await makeOps().runTransferJob(job, [source], target);
      expect(job.errors).toEqual([]);
    } finally {
      restore();
    }

    const copied = path.join(target, path.basename(source));
    expect(fs.readFileSync(path.join(copied, 'raiz.txt'), 'utf8')).toBe('raiz\n');
    expect(fs.readFileSync(path.join(copied, 'sub', 'nota.txt'), 'utf8')).toBe('hola\n');
  });

  it('finds an existing folder ready without asking the filesystem to create it', async () => {
    const dir = scratch('omni-ensure-ready-');
    const restore = refuseCreatingExistingDirectories();
    try {
      await expect(makeOps().ensureDirectory(dir)).resolves.toBeUndefined();
    } finally {
      restore();
    }
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('still creates the folders a copy needs on the way down', async () => {
    const root = scratch('omni-ensure-missing-');
    const dir = path.join(root, 'nueva', 'sub');
    await makeOps().ensureDirectory(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });
});

/**
 * A copy publishes each file by renaming its temporary over the destination, so
 * that same EPERM can fail a copy whose bytes are already written.
 */
describe('publishing a copied file', () => {
  it('reintenta el renombrado del temporal cuando Windows lo bloquea', async () => {
    const source = scratch('omni-copy-src-');
    const target = scratch('omni-copy-dst-');
    fs.writeFileSync(path.join(source, 'nota.txt'), 'hola\n', 'utf8');

    const realRename = fs.promises.rename.bind(fs.promises);
    let calls = 0;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      calls += 1;
      if (calls <= 2) {
        const busy = new Error(`EPERM: operation not permitted, rename '${String(from)}'`) as NodeJS.ErrnoException;
        busy.code = 'EPERM';
        throw busy;
      }
      return realRename(from, to);
    });

    try {
      await makeOps().runTransferJob(makeJob(), [source], target);
    } finally {
      vi.restoreAllMocks();
    }

    // Three attempts on the same temporary, and the file landed whole.
    expect(calls).toBe(3);
    const copied = path.join(target, path.basename(source), 'nota.txt');
    expect(fs.readFileSync(copied, 'utf8')).toBe('hola\n');
    expect(fs.readdirSync(path.dirname(copied)).sort()).toEqual(['nota.txt']);
  });
});

/**
 * A move is a rename, and the engine already treats a refused rename as EXDEV
 * and falls back to copy-then-delete. That fallback is the wrong answer for a
 * lock that lasts a few milliseconds, so the rename is retried first; the case
 * below drives a real move through a rename that fails twice.
 */
describe('moving a folder whose rename is refused for a moment', () => {
  it('retries the rename instead of copying and deleting', async () => {
    const source = scratch('omni-move-src-');
    const target = scratch('omni-move-dst-');
    fs.writeFileSync(path.join(source, 'nota.txt'), 'hola\n', 'utf8');

    const realRename = fs.promises.rename.bind(fs.promises);
    let calls = 0;
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      calls += 1;
      if (calls <= 2) {
        const busy = new Error(`EPERM: operation not permitted, rename '${String(from)}'`) as NodeJS.ErrnoException;
        busy.code = 'EPERM';
        throw busy;
      }
      return realRename(from, to);
    });

    const job = makeJob();
    job.op = 'move';
    try {
      await makeOps().runTransferJob(job, [source], target);
    } finally {
      rename.mockRestore();
    }

    // Three renames and no fallback: copy-then-delete would have left the source
    // for the engine to remove rather than renaming it away.
    expect(calls).toBe(3);
    expect(job.errors).toEqual([]);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(target, path.basename(source), 'nota.txt'), 'utf8')).toBe('hola\n');
  });
});

/**
 * A parked conflict is the one moment the transfer needs the user, and the wait it
 * sits on is bounded: the host has to hear about it while there is still time to
 * answer, not when the timeout has already failed the job.
 */
describe('a transfer parked on a conflict', () => {
  it('announces the wait before the answer is due, naming the file', async () => {
    const source = scratch('omni-wait-src-');
    const target = scratch('omni-wait-dst-');
    fs.writeFileSync(path.join(source, 'nota.txt'), 'hola\n', 'utf8');
    fs.writeFileSync(path.join(target, 'nota.txt'), 'otra\n', 'utf8');

    const announced: Job[] = [];
    const job: Job = { ...makeJob(), collision: 'ask', status: 'running', paused: false, cancelled: false };
    // A zero wait expires at once, which keeps the case short: the announcement has
    // to have happened before the job could fail on the deadline.
    const ops = makeOps({
      conflictAnswerMs: 0,
      // Captured by value: the engine clears the conflict when the wait expires, and
      // what the host reads is the job as it was handed over.
      onJobWaiting: (waiting: Job) =>
        announced.push({
          ...waiting,
          pendingConflict: waiting.pendingConflict ? { ...waiting.pendingConflict } : null,
        }),
    });

    // The file itself, not its folder: a folder copy would land in a subdirectory
    // that does not exist yet and never collide. The expiry fails the job, and the
    // announcement has to have happened before it.
    await expect(ops.runTransferJob(job, [path.join(source, 'nota.txt')], target)).rejects.toThrow(
      /No answer for the conflict/,
    );

    expect(announced.map((waited) => ({ id: waited.id, destination: waited.pendingConflict?.destination }))).toEqual([
      { id: 'job-root-test', destination: path.join(target, 'nota.txt') },
    ]);
    // The announced job is what the host turns into a toast, so it has to carry what a
    // notice needs: the engine parks it as `running`, the wait is the conflict, and the
    // deadline lets the toast come back before it runs out.
    expect(announced[0].pendingConflict?.expiresInMs).toBe(0);
    expect(conflictNotice(announced[0])?.body).toBe(`⏸ ${path.join(target, 'nota.txt')}`);
  });
});

/**
 * A repeat continues the batch instead of starting it over: what the stopped run
 * already copied is left alone, and only what is missing gets transferred again.
 */
describe('repeating a batch that stopped', () => {
  // A copy carries the source times onto the copy, so matching times are exactly what
  // the earlier run left behind.
  const landIdentical = (src: string, dest: string) => {
    fs.writeFileSync(src, 'hola\n', 'utf8');
    fs.writeFileSync(dest, 'hola\n', 'utf8');
    // Both stamped from one date: the two writes happen in the same millisecond, and
    // a check that leaned on the clock alone would pass by accident.
    const when = new Date('2026-01-02T03:04:05Z');
    fs.utimesSync(src, when, when);
    fs.utimesSync(dest, when, when);
  };

  it('skips a file the earlier run copied, without asking about it again', async () => {
    const source = scratch('omni-resume-src-');
    const target = scratch('omni-resume-dst-');
    const src = path.join(source, 'nota.txt');
    const dest = path.join(target, 'nota.txt');
    landIdentical(src, dest);

    const announced = vi.fn();
    const job: Job = {
      ...makeJob(),
      collision: 'ask',
      status: 'running',
      paused: false,
      cancelled: false,
      resumeExisting: true,
    };
    // No answer is queued: a prompt here would expire and fail the job, which is
    // precisely the repeat-of-a-settled-conflict this rule exists to prevent.
    const ops = makeOps({ conflictAnswerMs: 0, onJobWaiting: announced });

    await ops.runTransferJob(job, [src], target);

    expect(job.errors).toEqual([]);
    expect(announced).not.toHaveBeenCalled();
    expect(job.items.map((entry) => entry.status)).toEqual(['skipped']);
    expect(fs.readFileSync(dest, 'utf8')).toBe('hola\n');
  });

  it('still asks when the destination holds something else', async () => {
    const source = scratch('omni-resume-src-');
    const target = scratch('omni-resume-dst-');
    const src = path.join(source, 'nota.txt');
    fs.writeFileSync(src, 'hola\n', 'utf8');
    fs.writeFileSync(path.join(target, 'nota.txt'), 'otra cosa\n', 'utf8');

    const announced = vi.fn();
    const job: Job = {
      ...makeJob(),
      collision: 'ask',
      status: 'running',
      paused: false,
      cancelled: false,
      resumeExisting: true,
    };
    const ops = makeOps({ conflictAnswerMs: 0, onJobWaiting: announced });

    // Different bytes are not work the earlier run finished, so the user is asked.
    await expect(ops.runTransferJob(job, [src], target)).rejects.toThrow(/No answer for the conflict/);
    expect(announced).toHaveBeenCalledTimes(1);
  });

  it('keeps the conflict on a fresh batch, where an identical destination is still one', async () => {
    const source = scratch('omni-resume-src-');
    const target = scratch('omni-resume-dst-');
    const src = path.join(source, 'nota.txt');
    landIdentical(src, path.join(target, 'nota.txt'));

    const job: Job = { ...makeJob(), collision: 'ask', status: 'running', paused: false, cancelled: false };
    const ops = makeOps({ conflictAnswerMs: 0 });

    // Only a repeat may skip quietly; a first copy of the same name is a decision.
    await expect(ops.runTransferJob(job, [src], target)).rejects.toThrow(/No answer for the conflict/);
  });
});
