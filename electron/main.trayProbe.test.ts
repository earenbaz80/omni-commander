import { EventEmitter } from 'node:events';
import Module, { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `main.cjs` only requires the tray probe inside `app.whenReady()`, and only when
 * the app is not packaged and `TRAY_PROBE=1`. Loading the real file would open a
 * window and start the local server, so this suite replaces Electron and the
 * server, captures the ready callback and runs it by hand. The probe module is
 * intercepted too: loading it is exactly what the test is watching for.
 */

const require = createRequire(import.meta.url);
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const runtimeProcess = process as NodeJS.Process & { resourcesPath?: string };
const originalResourcesPath = runtimeProcess.resourcesPath;
const originalTrayProbe = process.env.TRAY_PROBE;
const originalPortableBuild = process.env.PORTABLE_EXECUTABLE_FILE;

type ReadyCallback = () => Promise<void>;

type Probe = {
  required: boolean;
  run: ReturnType<typeof vi.fn>;
};

type ElectronMock = {
  app: {
    getPath: () => string;
    setAppUserModelId: () => void;
    isPackaged: boolean;
    whenReady: () => { then: (callback: ReadyCallback) => Promise<void> };
    on: () => void;
    quit: () => void;
    exit: () => void;
  };
  BrowserWindow: typeof EventEmitter;
  WebContentsView: typeof EventEmitter;
  Menu: { buildFromTemplate: () => { items: unknown[] } };
  Tray: typeof EventEmitter;
  nativeImage: { createFromBuffer: () => { isEmpty: () => boolean }; createFromPath: () => object };
  dialog: { showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }> };
  shell: { openExternal: () => Promise<void> };
  session: {
    defaultSession: { setPermissionRequestHandler: () => void; setPermissionCheckHandler: () => void };
  };
  Notification: typeof EventEmitter & { isSupported: () => boolean };
  ipcMain: { handle: () => void; on: () => void };
};

const electronFor = (isPackaged: boolean, onReady: (callback: ReadyCallback) => void): ElectronMock => {
  class BrowserWindowMock extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      setVisualZoomLevelLimits: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      openDevTools: vi.fn(),
      send: vi.fn(),
      reload: vi.fn(),
      setBackgroundThrottling: vi.fn(),
    });
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    isDestroyed = () => false;
    isMinimized = () => false;
    isVisible = () => true;
    isFocused = () => true;
    loadFile = vi.fn();
    loadURL = vi.fn();
    hide = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
  }

  class TrayMock extends EventEmitter {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    popUpContextMenu = vi.fn();
    isDestroyed = () => false;
  }

  class NotificationMock extends EventEmitter {
    static isSupported = () => false;
    show = vi.fn();
  }

  return {
    app: {
      getPath: () => 'C:\\tmp\\omni-probe-test',
      setAppUserModelId: () => {},
      isPackaged,
      whenReady: () => ({
        then: (callback: ReadyCallback) => {
          onReady(callback);
          return Promise.resolve();
        },
      }),
      on: () => {},
      quit: () => {},
      exit: () => {},
    },
    BrowserWindow: BrowserWindowMock,
    WebContentsView: EventEmitter,
    Menu: { buildFromTemplate: () => ({ items: [] }) },
    Tray: TrayMock,
    nativeImage: {
      createFromBuffer: () => ({ isEmpty: () => false }),
      createFromPath: () => ({}),
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => {} },
    session: {
      defaultSession: {
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
      },
    },
    Notification: NotificationMock,
    ipcMain: { handle: () => {}, on: () => {} },
  };
};

const serverMock = {
  // The top-level subscription runs before `whenApiPortReady`, so a port here
  // makes the ready callback resolve without its four-second fallback.
  onPortReady: (callback: (port: number) => void) => callback(0),
  onJobFinished: () => {},
  onJobWaiting: () => {},
};

const updaterMock = Object.assign(new EventEmitter(), {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
});

const loadMain = async (isPackaged: boolean): Promise<Probe> => {
  const probe: Probe = { required: false, run: vi.fn() };
  let ready: ReadyCallback | undefined;
  const electronMock = electronFor(isPackaged, (callback) => {
    ready = callback;
  });

  loader._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') return electronMock;
    if (request === 'electron-updater') return { autoUpdater: updaterMock };
    if (request.endsWith('server.cjs')) return serverMock;
    if (request === '../scripts/tray-probe-main.cjs') {
      probe.required = true;
      return { run: probe.run };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  runtimeProcess.resourcesPath = 'C:\\tmp\\resources';
  process.env.TRAY_PROBE = '1';
  delete process.env.PORTABLE_EXECUTABLE_FILE;

  delete require.cache[require.resolve('./main.cjs')];
  require('./main.cjs');

  expect(ready).toBeTypeOf('function');
  await ready!();
  return probe;
};

afterEach(() => {
  loader._load = originalLoad;
  runtimeProcess.resourcesPath = originalResourcesPath;
  delete require.cache[require.resolve('./main.cjs')];
  if (originalTrayProbe === undefined) delete process.env.TRAY_PROBE;
  else process.env.TRAY_PROBE = originalTrayProbe;
  if (originalPortableBuild === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
  else process.env.PORTABLE_EXECUTABLE_FILE = originalPortableBuild;
});

describe('the tray probe entry point', () => {
  it('never requires the probe in a packaged app, even with TRAY_PROBE=1', async () => {
    const probe = await loadMain(true);

    expect(probe.required).toBe(false);
    expect(probe.run).not.toHaveBeenCalled();
  });

  it('runs the probe in development when TRAY_PROBE=1', async () => {
    const probe = await loadMain(false);

    expect(probe.required).toBe(true);
    expect(probe.run).toHaveBeenCalledTimes(1);
    expect(probe.run).toHaveBeenCalledWith(
      expect.objectContaining({
        inject: expect.any(Function),
        menu: expect.any(Function),
        window: expect.any(Function),
        open: expect.any(Function),
        quit: expect.any(Function),
      }),
    );
  });
});
