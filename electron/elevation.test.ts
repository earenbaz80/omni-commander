import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * The relaunch used to answer `ok` after four seconds on its own, while the
 * UAC prompt was still open. These tests pin the answer to what elevate.exe
 * actually reports: a refusal has to reach the window, and merely waiting must
 * never look like consent.
 */
const require = createRequire(import.meta.url);
const { ERROR_CANCELLED, launchElevated } = require('./elevation.cjs') as {
  ERROR_CANCELLED: number;
  launchElevated: (options: {
    elevatePath: string;
    target: string;
    log?: (message: string) => void;
    spawnImpl?: () => EventEmitter;
  }) => Promise<{ ok: boolean; reason?: string; detail?: string }>;
};

const launchWith = (child: EventEmitter, options: { log?: (message: string) => void } = {}) =>
  launchElevated({ elevatePath: 'elevate.exe', target: 'OmniCommander.exe', spawnImpl: () => child, ...options });

describe('launchElevated', () => {
  it('does not report success while Windows is still waiting for an answer', async () => {
    const child = new EventEmitter();
    let settled = false;
    const answer = launchWith(child).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    child.emit('exit', 0, null);
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it('reports a cancelled consent prompt instead of a restart', async () => {
    const child = new EventEmitter();
    const answer = launchWith(child);

    child.emit('exit', ERROR_CANCELLED, null);

    await expect(answer).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('keeps the helper exit code when the launch fails', async () => {
    const child = new EventEmitter();
    const answer = launchWith(child);

    child.emit('exit', 5, null);

    await expect(answer).resolves.toEqual({
      ok: false,
      reason: 'launch-failed',
      detail: 'elevate.exe exit 5',
    });
  });

  it('names the signal when the helper is killed before answering', async () => {
    const child = new EventEmitter();
    const answer = launchWith(child);

    child.emit('exit', null, 'SIGKILL');

    await expect(answer).resolves.toEqual({
      ok: false,
      reason: 'launch-failed',
      detail: 'elevate.exe signal SIGKILL',
    });
  });

  it('reports a helper that cannot be started', async () => {
    const child = new EventEmitter();
    const answer = launchWith(child);

    child.emit('error', new Error('spawn ENOENT'));

    await expect(answer).resolves.toEqual({
      ok: false,
      reason: 'spawn-failed',
      detail: 'spawn ENOENT',
    });
  });

  it('reports a synchronous spawn failure', async () => {
    const answer = await launchElevated({
      elevatePath: 'elevate.exe',
      target: 'OmniCommander.exe',
      spawnImpl: () => {
        throw new Error('EACCES');
      },
    });

    expect(answer).toEqual({ ok: false, reason: 'spawn-failed', detail: 'EACCES' });
  });
});
