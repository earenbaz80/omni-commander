/**
 * Boots the packaged Linux app on a runner without a display and asks the
 * window, over the DevTools protocol, whether it painted a file row.
 *
 * The Playwright suite already covers the sources, but it talks to Vite and to
 * a server the harness starts. What a Linux tester installs is this AppImage:
 * its own server, its own asar and the packaged renderer, none of which the
 * suite exercises. So this spawns the artifact, waits for its debugging port,
 * attaches Playwright to that existing Chromium and fails when no row appears,
 * when the renderer raised an error, or when the process died on the way.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const appImage = process.argv[2];
if (!appImage) {
  console.error('usage: node scripts/linux-app-smoke.mjs <path to the AppImage>');
  process.exit(2);
}

const port = Number(process.env.SMOKE_CDP_PORT ?? 9333);
const log = [];
let app;

function tail() {
  return log.join('').split('\n').slice(-40).join('\n');
}

function fail(reason) {
  console.error(`linux smoke: ${reason}`);
  console.error(`--- last lines of the app ---\n${tail()}`);
  try {
    process.kill(-app.pid, 'SIGKILL');
  } catch {
    // Already gone: nothing to clean up.
  }
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app = spawn(
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
for (const stream of [app.stdout, app.stderr]) {
  stream.on('data', (data) => log.push(String(data)));
}
// A missing or non-executable artifact fails in spawn, not in a signal, and an
// unhandled 'error' event would end the process with a stack instead of a reason.
app.on('error', (error) => fail(`the app could not be started: ${error.message}`));

const watchdog = setTimeout(() => fail('the app did not become usable within 180 s'), 180_000);

async function waitForDebuggingPort() {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (app.exitCode !== null) {
      fail(`the app exited with code ${app.exitCode} before opening its debugging port`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Nothing listening yet; keep waiting until the deadline.
    }
    if (Date.now() > deadline) fail('the app never opened its debugging port');
    await sleep(500);
  }
}

async function findWindow(browser) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().endsWith('index.html')) return page;
      }
    }
    if (Date.now() > deadline) fail('no window loaded the packaged index.html');
    await sleep(250);
  }
}

let browser;
try {
  await waitForDebuggingPort();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await findWindow(browser);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // A row carries `data-name` and only exists once a drive was confirmed and a
  // folder was listed, which is the line between "the shell painted" and "the
  // app works": the header alone stays up while the drive probe hangs.
  await page.locator('[data-name]').first().waitFor({ state: 'visible', timeout: 90_000 });
  const rows = await page.locator('[data-name]').count();
  const first = await page.locator('[data-name]').first().getAttribute('data-name');
  const url = page.url();
  const title = await page.title();

  if (errors.length > 0) fail(`the renderer raised ${errors.length} error(s): ${errors.join(' | ')}`);
  if (app.exitCode !== null) fail(`the app exited with code ${app.exitCode} after loading`);
  const fatal = log.join('').match(/Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND/);
  if (fatal) fail(`the app log carries "${fatal[0]}"`);

  clearTimeout(watchdog);
  console.log(JSON.stringify({ ok: true, rows, first, title, url }, null, 1));
} catch (error) {
  fail(String(error?.message ?? error));
} finally {
  try {
    process.kill(-app.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
  if (browser) await browser.close().catch(() => {});
}
