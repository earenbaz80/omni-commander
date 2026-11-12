import { test, expect, type Page } from '@playwright/test';
import { seedSettings } from './support/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import { removeWorkspace } from './support/tempWorkspaces';
import { BOOT_TIMEOUT_MS } from './support/boot';
import path from 'node:path';

/**
 * The context menu is the app's only `role="menu"`, and it used to be a plain
 * stack of buttons: no name, no role, and no keyboard. These cases pin what a
 * menu is expected to be, because the difference is invisible in a screenshot —
 * a screen reader announced a block of buttons and the arrows moved the panel
 * selection behind the open menu instead of walking the commands.
 */

const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

test.beforeEach(async ({ page }) => {
  await seedSettings(page, { language: 'es' });
});

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-menu-'));
  await fs.writeFile(path.join(workspace, 'nota.txt'), 'una nota\n', 'utf8');
  // A second entry below the menu's target: without one the panel has nowhere
  // to move and the case that guards against moving it would pass by accident.
  await fs.writeFile(path.join(workspace, 'otra.txt'), 'otra nota\n', 'utf8');
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

interface FocusInfo {
  tag: string;
  text: string;
  insideMenu: boolean;
}

async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: el ? el.tagName.toLowerCase() : 'none', text: '', insideMenu: false };
    }
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      insideMenu: !!el.closest('[role="menu"]'),
    };
  });
}

/** Opens the scratch folder in the left panel and puts the keyboard on its list. */
async function focusList(page: Page) {
  await page.locator('[data-path-bar]').nth(0).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(workspace);
  await input.press('Enter');

  await expect(page.locator('[data-name="nota.txt"]').first()).toBeVisible();
  // The menu remembers whatever had focus when it opened and gives it back on
  // close; a keyboard user starts on the list, so the case does too.
  await page.locator('[data-file-list]').first().focus();
}

test('the context menu is a named menu the keyboard can walk', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await focusList(page);

  await page.locator('[data-name="nota.txt"]').first().click({ button: 'right' });

  // A name, a role and real menu items: the three things it lacked.
  const menu = page.getByRole('menu', { name: 'Menú contextual' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  expect(await items.count()).toBeGreaterThan(5);

  // Focus enters on the first command.
  await expect(items.first()).toBeFocused();

  // The arrows walk the menu and wrap, and Home/End go to the ends.
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first(), 'ArrowDown on the last command wraps to the first').toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.last(), 'ArrowUp on the first command wraps to the last').toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();

  // Escape closes it and hands focus back to the list it came from, not the body.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const back = await focusInfo(page);
  expect(back, `closing the menu left focus on <${back.tag}> "${back.text}"`).toMatchObject({
    tag: 'div',
    insideMenu: false,
  });
  await expect(page.locator('[data-file-list]').first()).toBeFocused();
});

test('the arrows reach the menu, not the panel behind it', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await focusList(page);

  // The panel's arrow navigation is a global shortcut; with the menu open the
  // keys have to belong to the menu, or the selection moves behind it unseen.
  const focusedRow = () => page.locator('[data-focused="true"]').first().getAttribute('data-name');

  await page.locator('[data-name="nota.txt"]').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Menú contextual' });
  await expect(menu).toBeVisible();
  expect(await focusedRow()).toBe('nota.txt');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  expect(await focusedRow(), 'the panel selection moved while the menu was open').toBe('nota.txt');
});
