// @vitest-environment node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

const scratchDirs: string[] = [];

function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    fs.rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeOps(): FileOps {
  return createFileOps({
    noteFile: (job: Job, target: string, size: number) => {
      const entry: Entry = { path: target, size, copied: 0, status: 'pending' };
      job.items.push(entry);
      return entry;
    },
    waitWhilePaused: async () => undefined,
    sleep: async () => undefined,
    finishJob: () => undefined,
  });
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
