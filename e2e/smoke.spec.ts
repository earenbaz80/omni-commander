import { test, expect } from '@playwright/test';

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

  await expect(page.locator('body')).toContainText('OmniCommander Pro');
  expect(errors).toHaveLength(0);
});

test('header shows frameless window controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Minimizar')).toBeVisible();
  await expect(page.getByTitle('Cerrar')).toBeVisible();
});
