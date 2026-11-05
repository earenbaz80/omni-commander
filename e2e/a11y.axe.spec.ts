import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The case phase F5 could not close: an audit with `axe` over a window that the
 * keyboard has moved and resized.
 *
 * The existing `a11y.modals.spec.ts` checks that every control in a dialog has an
 * accessible name, which is what could be asserted without a browser audit. This
 * one covers the rest: the window is not where the browser put it, its title bar
 * is a focusable handle and its corner a focusable `separator`, and that is
 * exactly the state in which an audit sees things a fresh dialog does not —
 * elements that moved out of the viewport, a status region that has just spoken,
 * a value that appeared on the separator because the user set a size.
 *
 * The window is opened from the header and moved with the arrow keys only, so no
 * pointer is involved and the audit describes the keyboard path.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

test('a window moved and sized by keyboard has no axe violations', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  // The rows carry aria-pressed, which is the same structural hook the naming
  // audit waits for: nothing here depends on a style class or on the language.
  await page.waitForFunction(() => document.querySelectorAll('button[aria-pressed]').length > 20, undefined, {
    timeout: 60000,
    polling: 500,
  });

  await page.getByTitle('Configuración').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();

  // The bar is the handle and the corner the resizer; both are tab stops and
  // neither exists with an accessible role until the window can be moved.
  const handle = dialog.locator('[role="group"]').first();
  const corner = dialog.locator('[role="separator"]').first();
  await expect(handle).toBeVisible();
  await expect(corner).toBeVisible();
  await expect(handle).toHaveAttribute('aria-label', /\S/);

  const start = await dialog.boundingBox();
  expect(start, 'the window has to be on screen before it can be moved').not.toBeNull();

  await handle.focus();
  await expect(handle).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  const moved = await dialog.boundingBox();
  expect(moved, 'moving the window with the arrows kept it on screen').not.toBeNull();
  expect(moved!.x, 'two right presses move the window two steps right').toBeGreaterThan(start!.x + 20);

  // Before a size is chosen the width belongs to the dialog's design, so the
  // separator reports no value; after the first key press it must report one.
  await corner.focus();
  await expect(corner).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');

  const grown = await dialog.boundingBox();
  expect(grown!.width, 'the corner grows the window with the arrows').toBeGreaterThan(moved!.width + 10);
  await expect(corner).toHaveAttribute('aria-valuenow', /\d+/);

  // The size is only announced in words, so this region is the whole feedback
  // for a screen reader: it has to have said something by now.
  await expect(dialog.getByRole('status')).toContainText('×');

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});
