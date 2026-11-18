// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

/**
 * The installer is already verified and sitting in `pending/`. Asking for the
 * restart can still be refused, and `quitAndInstall` says so by throwing rather
 * than by emitting an event: the caller has to keep the reason instead of
 * letting it escape, or the window stays open with nothing on screen.
 */
const require = createRequire(import.meta.url);
const { restartFailure } = require('./updateRestart.cjs') as {
  restartFailure: (updater: { quitAndInstall: (...args: unknown[]) => unknown }) => string | null;
};

describe('reinicio del updater', () => {
  it('pide el reinicio en silencio y con la app abierta otra vez', () => {
    const quitAndInstall = vi.fn();
    expect(restartFailure({ quitAndInstall })).toBe(null);
    expect(quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('devuelve el motivo cuando el updater rechaza el reinicio', () => {
    const quitAndInstall = vi.fn(() => {
      throw new Error('spawn EACCES');
    });
    expect(restartFailure({ quitAndInstall })).toBe('spawn EACCES');
  });

  it('nombra un rechazo que no trae mensaje', () => {
    const quitAndInstall = vi.fn(() => {
      throw 'restart refused';
    });
    expect(restartFailure({ quitAndInstall })).toBe('restart refused');
  });
});
