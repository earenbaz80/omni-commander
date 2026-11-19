/**
 * The packaged app as the thing the suite drives.
 *
 * The specs were written against a Vite dev server: each test gets a browser
 * page, calls `page.goto('/')`, and the config's `webServer` puts an app behind
 * that URL. The package has a different shape -- Electron owns the window and
 * the app serves its own API on a port it picks -- so this module gives the
 * specs the same two promises in that shape:
 *
 * - a window that is on the app's own root, so `goto('/')` means "boot it";
 * - one window per test, with its own profile and its own server.
 *
 * One instance per test, not per run: specs seed settings with
 * `addInitScript`, which stays registered for every later navigation on the same
 * page, and the renderer keeps its localStorage. A window reused across tests
 * would therefore carry the previous test's settings into the next one, which is
 * exactly the isolation the suite is built on. A process per test is slower, and
 * the only way to keep that promise.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { freePortsSync } from '../../scripts/serverHarness';

/** How much of the app's output a launch failure reports. */
const TAIL_LINES = 40;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connects to the app's own debugging endpoint.
 *
 * `remote-debugging-port=0` would let Chromium pick a port, but the number only
 * reaches us through a file inside the profile; reserving the port here keeps
 * the launch and the attach in one place.
 */
async function waitForDebuggingPort(child: ReturnType<typeof spawn>, port: number, log: string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      const tail = log.join('').split('\n').slice(-TAIL_LINES).join('\n');
      throw new Error(`the app exited with code ${child.exitCode} before opening its debugging port\n${tail}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Nothing listening yet; keep waiting until the deadline.
    }
    if (Date.now() > deadline) throw new Error('the app never opened its debugging port');
    await sleep(250);
  }
}

/** The window that loaded the packaged renderer, not the tray or a browser view. */
async function findAppWindow(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().endsWith('index.html')) return page;
      }
    }
    if (Date.now() > deadline) throw new Error('no window loaded the packaged index.html');
    await sleep(250);
  }
}

export interface PackagedWindow {
  /** The app's window, with `goto('/')` turned into a reload of it. */
  page: Page;
  /** The app's output, for a failure that needs to say what the app said. */
  tail: () => string;
  /** Ends the app and throws its profile away. */
  stop: () => Promise<void>;
}

/**
 * Starts `appPath` with the flags the packaged scripts use and attaches to its
 * window.
 *
 * The flags are runner quirks, not app settings: the runner restricts
 * unprivileged user namespaces, has no GPU and mounts a small `/dev/shm`.
 * `APPIMAGE_EXTRACT_AND_RUN` keeps the AppImage from needing FUSE.
 */
export async function launchPackagedWindow(appPath: string): Promise<PackagedWindow> {
  const [cdpPort, apiPort] = freePortsSync(2) as [number, number];
  const profile = await mkdtemp(path.join(os.tmpdir(), 'omni-e2e-packaged-'));
  const log: string[] = [];

  const child = spawn(
    appPath,
    [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${cdpPort}`,
      // A fresh profile per test is what makes every test start from nothing:
      // localStorage, the settings the previous test seeded, the logs and the
      // map cache all live under this directory.
      `--user-data-dir=${profile}`,
    ],
    {
      env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', PORT: String(apiPort) },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => log.push(String(data)));
  }

  const stop = async () => {
    const gone = () => child.exitCode !== null || child.signalCode !== null;
    try {
      // The whole tree: an Electron parent leaves helpers behind if only it dies.
      // SIGTERM first, because an AppImage removes what it unpacked on a normal
      // exit and a killed one leaves that copy behind -- ninety of those filled
      // the runner's disk and the cases after them failed for it.
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      // Already gone: nothing to clean up.
    }
    const deadline = Date.now() + 3000;
    while (!gone() && Date.now() < deadline) await sleep(100);
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      // It exited on its own, which is the outcome this waits for.
    }
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  const tail = () => log.join('').split('\n').slice(-TAIL_LINES).join('\n');

  try {
    await waitForDebuggingPort(child, cdpPort, log);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = await findAppWindow(browser);
    // Hand the test a window whose document has finished loading. Reloading one
    // that is still in flight aborts the navigation instead of starting a new
    // one, and the first `goto('/')` of every test would fail on it.
    await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});

    // `page.goto('/')` is the suite's way of saying "boot the app". In the
    // package the window is already on that document, so the same intent is a
    // reload -- and the init scripts a spec registered beforehand run on it,
    // which is how `seedSettings` reaches the app.
    const rawGoto = page.goto.bind(page);
    (page as unknown as { goto: Page['goto'] }).goto = ((url: string, options?: Parameters<Page['goto']>[1]) =>
      url === '/' ? page.reload(options) : rawGoto(url, options)) as Page['goto'];

    const closeBrowser = () => browser.close().catch(() => {});

    return {
      page,
      tail,
      stop: async () => {
        await closeBrowser();
        await stop();
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
