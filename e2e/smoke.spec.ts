import { test, expect } from '@playwright/test';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * The first two questions anyone asks of the window: is it there, and does it
 * work.
 *
 * The name in the header and the window buttons are painted by the chrome,
 * which mounts whether or not the boot ever resolves, so waiting for them proves
 * that the shell rendered and nothing else. The app did exactly that while its
 * drive probe hung: header up, both panels empty. Both cases therefore wait for
 * `[data-name]` -- a row, which only exists once a drive was confirmed and a
 * folder was listed -- before they claim the app loaded.
 */

// Pin the UI language so the specs don't break if the app default changes.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

test('application loads without fatal errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await expect(page.locator('body')).toContainText('OmniCommander Pro');
  expect(errors).toHaveLength(0);
});

test('header shows frameless window controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await expect(page.getByTitle('Minimizar')).toBeVisible();
  await expect(page.getByTitle('Cerrar')).toBeVisible();
});
