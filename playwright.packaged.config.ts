/**
 * The suite's own specs against the artifact a user installs.
 *
 * `playwright.config.ts` tests the sources through Vite and Express, which is
 * the right loop for development and says nothing about the package: a bundle
 * that loads in the dev server can still boot to a blank window once Electron
 * and the asar are in the middle. The hand-written cases next door
 * (`scripts/linux-app-e2e.mjs`) answer that for four interactions; this config
 * answers it with the suite.
 *
 * Two assumptions of the specs are handled in `e2e/support`:
 *
 * - `page.goto('/')` becomes a reload of the packaged window, the same document
 *   the app boots on (`appTest.ts`, `packagedWindow.ts`);
 * - "a server per test" becomes an app per test: the window, its profile, its
 *   localStorage and the API it serves are all new in every case, which is the
 *   isolation the suite relies on.
 *
 * `dashboard-click.spec.ts` stays out: it navigates the page to the `__jobs`
 * HTML the API serves, and the packaged window refuses to leave its own two
 * documents (`electron/main.cjs`), so the case cannot run against the package
 * by design, not by accident.
 */
import { defineConfig } from '@playwright/test';

if (!process.env.OMNI_PACKAGED_APP) {
  throw new Error('OMNI_PACKAGED_APP must point at the packaged artifact this run drives');
}

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/dashboard-click.spec.ts'],
  // One app at a time: each case owns a window, a profile and a server, and
  // running them side by side would have several Electron instances competing
  // for the same virtual display.
  fullyParallel: false,
  workers: 1,
  // The dev config's 30 s default was measured against a server that was already
  // up. Here every case also starts the app, and the boot gate the specs use
  // allows it 90 s.
  timeout: 120_000,
  // A retry would relaunch the app and hide the first attempt's state; a case
  // that fails here is a finding, not a flake to paper over.
  retries: 0,
  reporter: [['list'], ['./e2e/support/packagedSummary.ts']],
  use: {
    trace: 'retain-on-failure',
  },
});
