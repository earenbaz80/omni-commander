/**
 * The `test` the specs import.
 *
 * In the default run this is Playwright's own, untouched: the dev config starts
 * its servers and the base `page` fixture opens a browser tab on them. When
 * `OMNI_PACKAGED_APP` names a packaged artifact, the same specs get the app's
 * window instead -- one per test, with its own profile -- so a spec can be
 * listed in `playwright.packaged.config.ts` without knowing which shape it runs
 * against.
 *
 * The alternative was a `test` import of its own inside every packaged spec,
 * which would have kept two versions of each file and made "does this spec run
 * against the package?" a property of its text instead of the config's list.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { launchPackagedWindow } from './packagedWindow';

const packagedApp = process.env.OMNI_PACKAGED_APP;

export const test = packagedApp
  ? base.extend<{ page: Page }>({
      page: async ({}, use) => {
        const window = await launchPackagedWindow(packagedApp);
        try {
          await use(window.page);
        } finally {
          await window.stop();
        }
      },
    })
  : base;

export { expect };
export type { Locator, Page, Route } from '@playwright/test';
