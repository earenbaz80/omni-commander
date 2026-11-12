import type { Page } from '@playwright/test';
import { SETTINGS_KEY } from '../../src/services/storage';

/**
 * Seeds the app's settings before the window boots.
 *
 * The key is the app's own constant, not a copy of it: a suite that types the
 * string out keeps working only until the store is renamed, and then fails for a
 * reason that says nothing about the feature under test. `SETTINGS_KEY` is
 * imported from the storage module, which is plain TypeScript with no browser
 * access at import time, so this file can run inside the Playwright process.
 *
 * `settings` is written as the previous session would have left it: the app reads
 * both the versioned envelope and a bare value, and the specs use both shapes.
 */
export async function seedSettings(page: Page, settings: unknown): Promise<void> {
  await page.addInitScript(
    ({ key, stored }) => {
      localStorage.setItem(key, stored);
    },
    { key: SETTINGS_KEY, stored: JSON.stringify(settings) },
  );
}
