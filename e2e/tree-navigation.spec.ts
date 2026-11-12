import { test, expect, type Page } from '@playwright/test';
import { seedSettings } from './support/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import { BOOT_TIMEOUT_MS } from './support/boot';
import { removeWorkspace } from './support/tempWorkspaces';
import path from 'node:path';

/**
 * The folder tree is a sidebar, not a control of the panel it happens to sit in.
 *
 * It used to navigate its own side and to steal the active panel when clicked,
 * so with the right panel in front of the user a choice made in the left tree
 * changed the left panel and the right one never moved -- the reported bug was
 * "selecting a path in the collapsible panel does nothing to the right panel".
 * This case presses through the real tree and reads both path bars afterwards.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

let leftDir = '';
let rightDir = '';

test.beforeEach(async ({ page }) => {
  // Pin the UI language: the tree's toggle carries a translated title.
  await seedSettings(page, { language: 'es' });

  leftDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-tree-l-'));
  rightDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-tree-r-'));
  await fs.writeFile(path.join(leftDir, 'izquierda.txt'), 'izquierda\n', 'utf8');
  await fs.writeFile(path.join(rightDir, 'derecha.txt'), 'derecha\n', 'utf8');
});

test.afterEach(async () => {
  for (const dir of [leftDir, rightDir]) {
    if (dir) await removeWorkspace(dir);
  }
});

/**
 * Types an absolute path into one panel's path bar and waits until the bar shows
 * it. A panel can still be settling the path it opened with right after load,
 * which would overwrite the first try, so the user action is repeated instead
 * of only waiting: the last attempt still has to pass a real assertion.
 */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  const bar = page.locator('[data-path-bar]').nth(panel);
  const input = page.locator('[data-path-input]');
  const folder = path.basename(target);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await bar.click();
    await expect(input).toHaveCount(1);
    await input.fill(target);
    await input.press('Enter');

    try {
      await expect(bar).toContainText(folder, { timeout: 4000 });
      return;
    } catch {
      // Try the same thing again; the final failure reports the real state.
    }
  }

  await expect(bar).toContainText(folder);
}

test('the folder tree navigates the panel the user is working in', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await enterPath(page, 0, leftDir);
  await enterPath(page, 1, rightDir);
  await expect(page.locator('[data-name="izquierda.txt"]')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await expect(page.locator('[data-name="derecha.txt"]')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  // The tree lives in the left panel, but the right one is where the user is.
  await page.getByRole('button', { name: 'Árbol', exact: true }).first().click();
  const tree = page.locator('[data-tree-pane]');
  await expect(tree).toBeVisible();
  await page.locator('[data-file-list]').nth(1).click();

  const active = page.locator('[data-file-list][data-file-list-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute('aria-label', /derecho/);

  const bars = page.locator('[data-path-bar]');
  const leftBefore = (await bars.nth(0).innerText()).trim();
  expect(leftBefore).toContain('omni-e2e-tree-l-');

  // A drive row in the tree opens that drive.
  await tree.getByText('[C:]', { exact: true }).click();

  await expect.poll(async () => (await bars.nth(1).innerText()).trim()).toBe('C:\\');
  // The panel the tree is drawn in did not move, and it did not take the focus.
  await expect.poll(async () => (await bars.nth(0).innerText()).trim()).toContain('omni-e2e-tree-l-');
  await expect(active).toHaveAttribute('aria-label', /derecho/);
});
