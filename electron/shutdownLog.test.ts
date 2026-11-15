import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type ShutdownLog = {
  noteQuitReason: (reason: string) => void;
  logShutdown: (event: string, detail?: string) => void;
};

const shutdown = require('./shutdownLog.cjs') as ShutdownLog;

let dir: string;
let previousLogDir: string | undefined;

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
  it('records every shutdown event and keeps the first cause through process exit', () => {
    shutdown.noteQuitReason('tray');
    shutdown.logShutdown('tray-quit');
    shutdown.noteQuitReason('window-all-closed');
    shutdown.logShutdown('before-quit');
    shutdown.logShutdown('window-all-closed');
    shutdown.logShutdown('process-exit', 'code=0');

    expect(lines()).toEqual([
      expect.stringMatching(/event=tray-quit reason=tray$/),
      expect.stringMatching(/event=before-quit reason=tray$/),
      expect.stringMatching(/event=window-all-closed reason=tray$/),
      expect.stringMatching(/event=process-exit reason=tray code=0$/),
    ]);
  });
});
