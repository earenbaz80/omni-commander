// @vitest-environment node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The diagnostic logs are the only record of a transfer that never started or a
 * relaunch that went nowhere, so the fast path of reporting a problem must not
 * turn into a slow one: a copy that stalls appends a line every couple of
 * seconds, and a log left to grow without bound ends up too big to open and too
 * big to attach to a report.
 *
 * What is promised, and what these tests refuse to let slip: a log stays within
 * one megabyte, exactly one previous file is kept beside it, and no line written
 * is lost by rolling over. Every case drives the real module against a real
 * folder -- the file size is the thing being tested, and a mock would answer
 * whatever it was told, including the size the bug is about.
 */

const require = createRequire(import.meta.url);

interface ScratchLogs {
  logsDir: () => string;
  logFile: (name: string) => string;
  appendLog: (name: string, line: string) => void;
  appendLogSync: (name: string, line: string) => void;
}

const { appendLog, appendLogSync, logFile, logsDir } = require('./server/scratch.cjs') as ScratchLogs;

/** The limit the module holds itself to: one megabyte per file, one rolled copy. */
const LIMIT_BYTES = 1024 * 1024;

/** Folders this file created, so a failing expectation cannot leave them behind. */
const dirs: string[] = [];
const previousLogDir = process.env.OMNI_LOG_DIR;

function logsFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-logs-'));
  dirs.push(dir);
  process.env.OMNI_LOG_DIR = dir;
  return dir;
}

afterEach(() => {
  if (previousLogDir === undefined) delete process.env.OMNI_LOG_DIR;
  else process.env.OMNI_LOG_DIR = previousLogDir;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Size of a file, or zero when it is not there: absence is a valid state here. */
function size(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function readLines(file: string): string[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Waits for a fire-and-forget append to land. A fixed delay would either be a
 * slow test or a flaky one; polling for the line is neither.
 */
async function waitForLines(file: string, count: number): Promise<string[]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const lines = readLines(file);
    if (lines.length >= count) return lines;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readLines(file);
}

/** A line of a known size, so the total written is arithmetic rather than luck. */
const filler = (bytes: number) => 'x'.repeat(bytes);

describe('the diagnostic logs', () => {
  it('writes into the folder OMNI_LOG_DIR names', () => {
    const dir = logsFolder();
    appendLogSync('omnicommander-job.log', 'una linea');

    expect(logFile('omnicommander-job.log')).toBe(path.join(dir, 'omnicommander-job.log'));
    expect(logsDir()).toBe(dir);
    expect(fs.readFileSync(path.join(dir, 'omnicommander-job.log'), 'utf8')).toBe('una linea\n');
  });

  it('rolls over instead of letting a log pass a megabyte', () => {
    logsFolder();
    const file = logFile('omnicommander-job.log');
    appendLogSync('omnicommander-job.log', 'la primera');
    for (let i = 0; i < 22; i += 1) appendLogSync('omnicommander-job.log', filler(60_000));

    // Neither file is allowed to hold more than the limit...
    expect(size(file)).toBeLessThanOrEqual(LIMIT_BYTES);
    expect(size(`${file}.1`)).toBeLessThanOrEqual(LIMIT_BYTES);
    // ...and rolling over loses nothing: the whole history is still there.
    expect(size(file) + size(`${file}.1`)).toBeGreaterThan(22 * 60_000);
    // The previous file holds the older half; the newest line is in the live one.
    expect(readLines(`${file}.1`)[0]).toBe('la primera');
    const live = readLines(file);
    expect(live[live.length - 1]).toBe(filler(60_000));
  });

  it('keeps one previous file, not a pile of them', () => {
    logsFolder();
    const file = logFile('omnicommander-job.log');
    for (let i = 0; i < 90; i += 1) appendLogSync('omnicommander-job.log', filler(60_000));

    // Five megabytes written over the limit and still two files: a log that
    // rolls into `.2`, `.3` carries a pile nobody reads and no bound at all.
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['omnicommander-job.log', 'omnicommander-job.log.1']);
    expect(size(file)).toBeLessThanOrEqual(LIMIT_BYTES);
    expect(size(`${file}.1`)).toBeLessThanOrEqual(LIMIT_BYTES);
  });

  it('rolls over a log that was already full when the run started', () => {
    logsFolder();
    const file = logFile('omnicommander-fs.log');
    // What a previous run, or a process killed before it could rotate, leaves.
    fs.writeFileSync(file, filler(LIMIT_BYTES + 1));
    appendLogSync('omnicommander-fs.log', 'nueva');

    expect(size(`${file}.1`)).toBe(LIMIT_BYTES + 1);
    expect(fs.readFileSync(file, 'utf8')).toBe('nueva\n');
  });

  it('appends without making the caller wait for the disk', async () => {
    logsFolder();
    const file = logFile('omnicommander-fs.log');
    appendLog('omnicommander-fs.log', 'rechazo');

    expect(await waitForLines(file, 1)).toEqual(['rechazo']);
  });

  it('never throws, even when the folder cannot be written', () => {
    // The log folder is a file, so it cannot be created or written into.
    const blocked = path.join(logsFolder(), 'no-es-una-carpeta');
    fs.writeFileSync(blocked, '');
    process.env.OMNI_LOG_DIR = blocked;

    expect(() => appendLogSync('omnicommander-job.log', 'x')).not.toThrow();
    expect(() => appendLog('omnicommander-job.log', 'x')).not.toThrow();
  });
});
