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
 * Three specs stay out, each for a reason the package cannot change:
 *
 * - `dashboard-click.spec.ts` navigates the page to the `__jobs` HTML the API
 *   serves, and the packaged window refuses to leave its own two documents
 *   (`electron/main.cjs`);
 * - `a11y.axe.spec.ts` asks `@axe-core/playwright` for a page of its own, and a
 *   browser driven over Electron's debugging port cannot open one
 *   (`Target.createTarget: Not supported`);
 * - `settings-updates.spec.ts` feeds the update check from the spec and waits for
 *   the dialogs that follow, which the packaged updater does not offer -- its
 *   feed lives in the main process, outside anything the page can intercept.
 */
import { defineConfig } from '@playwright/test';

if (!process.env.OMNI_PACKAGED_APP) {
  throw new Error('OMNI_PACKAGED_APP must point at the packaged artifact this run drives');
}

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/dashboard-click.spec.ts', '**/a11y.axe.spec.ts', '**/settings-updates.spec.ts'],
  // One app at a time: each case owns a window, a profile and a server, and
  // running them side by side would have several Electron instances competing
  // for the same virtual display.
  fullyParallel: false,
  workers: 1,
  // The dev config's 30 s default was measured against a server that was already
  // up. Here every case also starts the app, and the boot gate the specs use
  // allows it 90 s.
  timeout: 120_000,
  // One retry in CI, for the reason the dev config gives: a broken case fails on
  // both attempts, while a runner whose egress stalls the app's own update check
  // can push a first listing past the wait once. Locally there is none.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['./e2e/support/packagedSummary.ts']],
  use: {
    trace: 'retain-on-failure',
  },
});
