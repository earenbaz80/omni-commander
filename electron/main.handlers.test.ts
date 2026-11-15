import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Module from 'node:module';

/**
 * `main.cjs` is the Electron entry point: it opens the window, starts the local
 * server and wires the renderer to the tray and the updater. Those are not
 * branches the renderer coverage can see, and loading the file for real would
 * start a server and ask Electron for a window. This test replaces the two
 * modules it requires at load time, then checks the answers a frame that is not
 * the app window gets: every one of them is a safe refusal, never an action on
 * a window that is not there.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const electronMock = {
  app: {
    getPath: () => 'C:\\tmp\\omni',
    setAppUserModelId: () => {},
    isPackaged: false,
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
    exit: () => {},
  },
  BrowserWindow: class {},
  WebContentsView: class {},
  Menu: { buildFromTemplate: () => ({}) },
  Tray: class {},
  nativeImage: { createFromPath: () => ({}) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: async () => {} },
  session: { defaultSession: {} },
  Notification: class {},
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn),
    on: () => {},
  },
};

// The real module starts the local API at load time. Its handlers are exercised
// by their own suites; here only the IPC wiring of main is under test.
const serverMock = {
  onPortReady: () => {},
  onJobFinished: () => {},
  onJobWaiting: () => {},
};

const loader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = loader._load;

beforeAll(async () => {
  loader._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') return electronMock;
    if (request.endsWith('server.cjs')) return serverMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  await import('./main.cjs');
});

afterAll(() => {
  loader._load = originalLoad;
});

const call = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
const stray = { sender: {} };

describe('main IPC handlers without an app window', () => {
  it('refuses every updater command from a frame that is not the app window', async () => {
    expect(call('update:state', stray)).toBeNull();
    expect(await call('update:check', stray)).toMatchObject({ status: 'idle', enabled: false });
    expect(await call('update:channel', stray, 'beta')).toMatchObject({ channel: 'stable' });
    expect(await call('update:download', stray)).toMatchObject({ status: 'idle' });
    expect(call('update:install', stray)).toBe(false);
  });

  it('refuses external links and browser commands without the app window', async () => {
    expect(await call('app:open-external', stray, 'https://example.com')).toBe(false);
    expect(call('browser:open', stray, 'https://example.com')).toEqual({ ok: false });
    expect(call('browser:navigate', stray, 'https://example.com')).toEqual({ ok: false });
    expect(call('browser:command', stray, 'back')).toBe(false);
    expect(call('browser:set-bounds', stray, { width: 10, height: 10 })).toBe(false);
    expect(call('browser:close', stray)).toBe(false);
  });

  it('has no window to minimise, maximise or close', () => {
    expect(call('window:minimize')).toBeUndefined();
    expect(call('window:maximize')).toBeUndefined();
    expect(call('window:close')).toBeUndefined();
  });

  it('returns no picked paths when there is no window to own the dialog', async () => {
    expect(await call('dialog:pick-paths', stray, { mode: 'folders' })).toEqual([]);
  });

  it('reports a failed elevation instead of relaunching without the helper', async () => {
    const result = await call('app:relaunch-admin');
    expect(result).toMatchObject({ ok: false });
  });
});
