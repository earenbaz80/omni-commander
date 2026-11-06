// @vitest-environment node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A destination that stops accepting bytes.
 *
 * The engine writes through a Node stream, so a sink that never completes its
 * write is not a mock of the guard -- it is the condition the guard exists for:
 * `write()` returns false, no `drain` ever arrives, and the only way out is the
 * timer. The sink below is a real `Writable` whose `_write` never calls its
 * callback, which is exactly what an unplugged drive or a dead share looks like
 * from the process that is writing.
 *
 * The suite's default run injects a one-second limit so it stays fast. The real
 * 60 s default, the number a user actually waits, is verified by running:
 *
 *   OMNI_WRITE_STALL_REAL=1 npx vitest run server/fileOps.stall.test.ts
 *
 * That run takes a minute and asserts the same message names 60s, the file, and
 * how far the copy had got before the destination stopped taking bytes.
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
  runTransferJob: (job: Job, sources: string[], targetDir: string) => Promise<void>;
}

const { createFileOps } = require('./fileOps.cjs') as {
  createFileOps: (deps: Record<string, unknown>) => FileOps;
};

/** The default the engine ships with; the real-mode run must not inject anything. */
const REAL_LIMIT_MS = 60000;
const realLimit = process.env.OMNI_WRITE_STALL_REAL === '1';
const stallMs = realLimit ? REAL_LIMIT_MS : 1000;

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

/** Accepts the write and never completes it: no drain, no finish, no error. */
function stuckSink(): Writable {
  return new Writable({
    highWaterMark: 1,
    write() {
      // Deliberately never calls the callback: the destination stopped taking data.
    },
  });
}

function makeOps(): FileOps {
  return createFileOps({
    // Omitting the value in real mode is what proves the shipped 60 000 ms default.
    ...(realLimit ? {} : { writeStallMs: stallMs }),
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
    id: 'job-stall-test',
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

describe('a destination that stops accepting data', () => {
  it(
    'gives up at the limit and says how long it waited and where',
    { timeout: realLimit ? 120000 : 20000 },
    async () => {
      const source = scratch('omni-stall-src-');
      const target = scratch('omni-stall-dst-');
      fs.writeFileSync(path.join(source, 'grande.bin'), Buffer.alloc(2 * 1024 * 1024, 7));

      const sink = stuckSink();
      const realCreateWriteStream = fs.createWriteStream;
      fs.createWriteStream = (() => sink) as unknown as typeof fs.createWriteStream;

      const job = makeJob();
      const startedAt = Date.now();
      try {
        // The sink has to be the one the engine gets, or the copy below would run
        // against a real file and prove nothing about a stalled destination.
        expect(fs.createWriteStream(path.join(target, 'probe'))).toBe(sink);
        await makeOps().runTransferJob(job, [source], target);
      } finally {
        fs.createWriteStream = realCreateWriteStream;
        sink.destroy();
      }

      const waited = Date.now() - startedAt;
      const destination = path.win32.join(target, path.win32.basename(source));
      process.stdout.write(`write stall: waited ${waited} ms -> ${job.errors[0]?.message}\n`);

      // The timer is the only thing that can end this copy, so it has to have run
      // its full budget -- not an earlier error escaping under the same name.
      expect(waited).toBeGreaterThanOrEqual(stallMs - 50);
      expect(job.itemsDone).toBe(0);
      expect(job.items[0]?.status).toBe('error');
      expect(job.errors).toHaveLength(1);
      expect(job.errors[0].path).toBe(source);
      expect(job.errors[0].message).toContain(`stopped accepting data for ${Math.round(stallMs / 1000)}s`);
      expect(job.errors[0].message).toContain(destination);
      // The first 1 MiB chunk is the one the sink refused, so the message has to
      // carry its size and the size of the whole file next to the source path.
      expect(job.errors[0].message).toContain(
        `after ${1024 * 1024} of ${2 * 1024 * 1024} bytes from ${path.join(source, 'grande.bin')}`,
      );
    },
  );
});
