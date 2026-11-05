import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Booting with the drives key already written by the versioned reader.
 *
 * This is the shape that reached a release as "No se pudo pintar esta parte de la
 * interfaz": older builds read `nc_drives_v1` with a raw `JSON.parse`, and a value
 * stamped `{ version, value }` came back as an object. The engine then handed that
 * object to `[...drives]` on the first render and the whole window fell to the
 * error boundary. The reader now validates and unwraps, so both shapes boot, and
 * a value that is not a list costs the saved drives instead of the app.
 */
const DRIVES_KEY = 'nc_drives_v1';

const realDrive = {
  id: 'real_C',
  letter: 'C:',
  name: 'Windows',
  type: 'local' as const,
  totalBytes: 100,
  freeBytes: 40,
  isMounted: true,
};

describe('engine boot with a stored drives key', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('unwraps the envelope a newer build writes', async () => {
    localStorage.setItem(DRIVES_KEY, JSON.stringify({ version: 1, value: [realDrive] }));

    const { fsEngine } = await import('./fileSystem');

    expect(fsEngine.getDrives().map((drive) => drive.letter)).toEqual(['C:']);
  });

  it('reads the bare array written before the envelope existed', async () => {
    localStorage.setItem(DRIVES_KEY, JSON.stringify([realDrive]));

    const { fsEngine } = await import('./fileSystem');

    expect(fsEngine.getDrives().map((drive) => drive.letter)).toEqual(['C:']);
  });

  it('boots with no drives when the saved value is not a list', async () => {
    localStorage.setItem(DRIVES_KEY, JSON.stringify({ version: 1, value: { letter: 'C:' } }));

    const { fsEngine } = await import('./fileSystem');

    expect(fsEngine.getDrives()).toEqual([]);
  });

  it('boots with no drives when the saved value is an object without an envelope', async () => {
    localStorage.setItem(DRIVES_KEY, JSON.stringify({ letter: 'C:', name: 'Windows' }));

    const { fsEngine } = await import('./fileSystem');

    expect(fsEngine.getDrives()).toEqual([]);
  });
});
