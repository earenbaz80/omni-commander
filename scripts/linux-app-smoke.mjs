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
 *
 * It answers one question -- does the package boot -- and `linux-app-e2e.mjs`
 * asks the next three, so a red here is never confused with a broken operation.
 */
import { appendSummary, attachToWindow, escapeCommandData, startPackagedApp } from './linux-app-harness.mjs';

const appImage = process.argv[2];
if (!appImage) {
  console.error('usage: node scripts/linux-app-smoke.mjs <path to the AppImage>');
  process.exit(2);
}

const port = Number(process.env.SMOKE_CDP_PORT ?? 9333);
const app = startPackagedApp(appImage, port);
let browser;

/**
 * The run page is where this verdict has to land: downloading the job log cuts
 * off before this step, so a failure that only reached stdout reached nobody.
 */
function fail(reason) {
  const lastLines = app.tail() || '(the app printed nothing)';
  const report = `linux smoke: ${reason}\n--- last lines of the app ---\n${lastLines}`;
  console.error(report);
  console.error(`::error::${escapeCommandData(report)}`);
  appendSummary(
    [
      '### Linux AppImage smoke: failed',
      '',
      `**Reason:** ${reason}`,
      '',
      '<details><summary>Last lines of the app log</summary>',
      '',
      '````',
      lastLines,
      '````',
      '',
      '</details>',
    ].join('\n'),
  );
  app.stop();
  process.exit(1);
}

const watchdog = setTimeout(() => fail('the app did not become usable within 180 s'), 180_000);

try {
  const attached = await attachToWindow(app, port);
  browser = attached.browser;
  const page = attached.page;

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
  if (app.child.exitCode !== null) fail(`the app exited with code ${app.child.exitCode} after loading`);
  const fatal = app.log.join('').match(/Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND/);
  if (fatal) fail(`the app log carries "${fatal[0]}"`);

  clearTimeout(watchdog);
  const result = { ok: true, rows, first, title, url };
  console.log(JSON.stringify(result, null, 1));
  appendSummary(['### Linux AppImage smoke: passed', '', '```json', JSON.stringify(result, null, 2), '```'].join('\n'));
} catch (error) {
  fail(String(error?.message ?? error));
} finally {
  app.stop();
  if (browser) await browser.close().catch(() => {});
}
