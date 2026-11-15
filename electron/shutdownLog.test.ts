import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type ShutdownLog = {
  SHUTDOWN_LOG: string;
  noteQuitReason: (reason: string) => void;
  resetQuitReason: () => void;
  logShutdown: (event: string, detail?: string) => void;
};

let dir: string;
let previousLogDir: string | undefined;

const load = (): ShutdownLog => {
  delete require.cache[require.resolve('./shutdownLog.cjs')];
  const shutdown = require('./shutdownLog.cjs') as ShutdownLog;
  shutdown.resetQuitReason();
  return shutdown;
};

const lines = (): string[] => fs.readFileSync(path.join(dir, 'omnicommander-shutdown.log'), 'utf8').trim().split('\n');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-shutdown-'));
  previousLogDir = process.env.OMNI_LOG_DIR;
  process.env.OMNI_LOG_DIR = dir;
});

afterEach(() => {
  if (previousLogDir === undefined) delete process.env.OMNI_LOG_DIR;
  else process.env.OMNI_LOG_DIR = previousLogDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the shutdown log', () => {
  it('records the tray action and keeps it as the reason through before-quit', () => {
    const shutdown = load();
    shutdown.noteQuitReason('tray');
    shutdown.logShutdown('tray-quit');
    shutdown.noteQuitReason('window-all-closed');
    shutdown.logShutdown('before-quit');

    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z pid=\d+ event=tray-quit reason=tray$/);
    expect(lines()[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z pid=\d+ event=before-quit reason=tray$/);
  });

  it('names window-all-closed and records the exit code in the last line', () => {
    const shutdown = load();
    shutdown.noteQuitReason('window-all-closed');
    shutdown.logShutdown('window-all-closed');
    shutdown.logShutdown('process-exit', 'code=0');

    expect(lines()).toEqual([
      expect.stringMatching(/event=window-all-closed reason=window-all-closed$/),
      expect.stringMatching(/event=process-exit reason=window-all-closed code=0$/),
    ]);
  });

  it('says unknown when no cause was noted', () => {
    const shutdown = load();
    shutdown.logShutdown('before-quit');

    expect(lines()[0]).toMatch(/event=before-quit reason=unknown$/);
  });
});
