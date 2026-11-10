import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { removeWorkspace } from './support/tempWorkspaces';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * Back and forward are entrances to a folder, and a protected folder has to ask
 * for its password on every one of them.
 *
 * The history buttons used to write `currentPath` straight into the tab, so the
 * password was needed to open the folder from the list and never again once the
 * back button pointed at it: from the parent, one click showed its contents.
 * This case walks the real interface -- enter with the password, go up, press
 * back -- and asserts that the prompt comes back and the panel stays put.
 *
 * The protection is seeded instead of typed through the dialog: what is under
 * test is the history guard, and seeding keeps the case about that. The record
 * is the same PBKDF2-SHA256 one the app stores (100k iterations, 32 bytes), so
 * the password is verified by the app's own code.
 */

const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

const PASSWORD = 'secreto';
const SALT_BYTES = Buffer.from('saltsaltsaltsalt', 'utf8');
const RECORD = {
  salt: SALT_BYTES.toString('base64'),
  hash: pbkdf2Sync(PASSWORD, SALT_BYTES, 100_000, 32, 'sha256').toString('base64'),
};

let workspace = '';
let locked = '';

test.beforeEach(async ({ page }) => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-guard-'));
  locked = path.join(workspace, 'locked');
  await fs.mkdir(locked);
  await fs.writeFile(path.join(locked, 'secreto.txt'), 'adentro\n', 'utf8');
  // Something outside the protected folder, so "still in the parent" is visible.
  await fs.writeFile(path.join(workspace, 'afuera.txt'), 'afuera\n', 'utf8');

  const settings = { language: 'es', protectedFolders: { [locked]: RECORD } };
  await page.addInitScript((seed) => {
    localStorage.setItem('nc_settings_v1', JSON.stringify(seed));
  }, settings);
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

/**
 * Types an absolute path into the left panel's path bar. A panel can still be
 * settling the path it opened with right after load, which would overwrite the
 * first try, so the action is repeated and the last one still has to pass.
 */
async function enterPath(page: Page, target: string) {
  const bar = page.locator('[data-path-bar]').nth(0);
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
      // Same action again; the final failure reports the real state.
    }
  }

  await expect(bar).toContainText(folder);
}

const pathBar = (page: Page) => page.locator('[data-path-bar]').nth(0);
const unlockPrompt = (page: Page) => page.getByText('Acceso Protegido por Contraseña');

async function unlock(page: Page) {
  await unlockPrompt(page).waitFor({ state: 'visible' });
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Desbloquear' }).click();
}

test('going back into a protected folder asks for its password again', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  await enterPath(page, workspace);
  await expect(page.locator('[data-name="afuera.txt"]').first()).toBeVisible();

  // The first entrance is guarded too: the record came from the settings.
  await page.locator('[data-name="locked"]').first().dblclick();
  await unlock(page);
  await expect(pathBar(page)).toContainText('locked');
  await expect(page.locator('[data-name="secreto.txt"]').first()).toBeVisible();

  // Out to the parent, which is where the user was before entering.
  await page.locator('[title="Directorio superior (Retroceso)"]').first().click();
  await expect(pathBar(page)).toContainText('omni-e2e-guard-');
  await expect(pathBar(page)).not.toContainText('locked');
  await expect(page.locator('[data-name="afuera.txt"]').first()).toBeVisible();

  // The history points at the protected folder, so this is the entrance that
  // used to skip the prompt: the panel must not move and the modal must open.
  const back = page.locator('[title="Atrás"]').first();
  await expect(back).toBeEnabled();
  await back.click();

  await expect(unlockPrompt(page)).toBeVisible();
  await expect(pathBar(page)).toContainText('omni-e2e-guard-');
  await expect(pathBar(page)).not.toContainText('locked');
  await expect(page.locator('[data-name="secreto.txt"]')).toHaveCount(0);

  // And the prompt is not a dead end: the password opens the folder as usual.
  await unlock(page);
  await expect(pathBar(page)).toContainText('locked');
  await expect(page.locator('[data-name="secreto.txt"]').first()).toBeVisible();
});
