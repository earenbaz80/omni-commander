/**
 * Spawns the packaged AppImage and hands back the window that opens.
 *
 * The smoke and the interaction cases drive the same artifact, and the flags
 * below are runner quirks rather than app behaviour: without them Electron never
 * paints on a machine with no display, no GPU and a small `/dev/shm`. They live
 * in one place so one script cannot keep a flag the other drops and pass for a
 * reason of its own.
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { chromium } from 'playwright';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How much of the app's output a failure reports. */
const TAIL_LINES = 40;

/**
 * Starts the AppImage and collects its output.
 *
 * `detached` puts the app in its own process group, so `stop` can take the whole
 * tree down instead of leaving an Electron child behind.
 */
export function startPackagedApp(appImage, port) {
  const log = [];
  let spawnError = null;
  const child = spawn(
    appImage,
    [
      // The runner restricts unprivileged user namespaces, so Chromium's sandbox
      // cannot start there; a virtual display has no GPU, and /dev/shm is small.
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
    ],
    {
      // FUSE is not guaranteed on the runner image; this makes the runtime unpack
      // itself instead of mounting, which needs no privileged helper.
      env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => log.push(String(data)));
  }
  // A missing or non-executable artifact fails in spawn, not in a signal, and an
  // unhandled 'error' event would end the process with a stack instead of a
  // reason.
  child.on('error', (error) => {
    spawnError = error;
  });

  return {
    child,
    log,
    spawnError: () => spawnError,
    tail: () => log.join('').split('\n').slice(-TAIL_LINES).join('\n'),
    stop: () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone: nothing to clean up.
      }
    },
  };
}

/** Waits until the debugging port answers, failing on an exit or a dead spawn. */
export async function waitForDebuggingPort(app, port) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const spawnError = app.spawnError();
    if (spawnError) throw new Error(`the app could not be started: ${spawnError.message}`);
    if (app.child.exitCode !== null) {
      throw new Error(`the app exited with code ${app.child.exitCode} before opening its debugging port`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Nothing listening yet; keep waiting until the deadline.
    }
    if (Date.now() > deadline) throw new Error('the app never opened its debugging port');
    await sleep(500);
  }
}

/** The window, once one of them has loaded the packaged `index.html`. */
async function findWindow(browser) {
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

/** Connects to the running app and returns the window it painted. */
export async function attachToWindow(app, port) {
  await waitForDebuggingPort(app, port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await findWindow(browser);
  return { browser, page };
}

/** Polls `condition` until it holds, and names what it was waiting for. */
export async function waitFor(condition, { timeoutMs = 30_000, intervalMs = 250, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
    await sleep(intervalMs);
  }
}

/** The escaping a workflow command needs: `%`, carriage returns and newlines. */
export function escapeCommandData(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * Appends to the run's step summary, when there is one.
 *
 * A failed write is not raised here: the step checks the file afterwards and
 * says so once, which beats two competing reasons for the same red.
 */
export function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `${markdown}\n`);
  } catch {
    // Reported by the step's own guard, not by a stack trace here.
  }
}
