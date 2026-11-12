import { test, expect, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/services/storage';
import { seedSettings } from './support/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeWorkspace } from './support/tempWorkspaces';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * The dialog that protects a folder, walked through the real interface.
 *
 * The history guard already proves that a protected folder asks for its
 * password on every entrance, and it seeds the stored record straight into
 * localStorage because what it tests is the guard. That leaves the dialog
 * itself -- the only thing that writes such a record, and the only way a user
 * removes one -- uncovered end to end: its two refusals, the record it stores,
 * and the removal that has to make the folder ordinary again.
 *
 * What is asserted about the record is the shape the app promises: a salt and a
 * PBKDF2 hash in the stored settings' `protectedFolders`, with the typed password
 * nowhere in the stored JSON.
 */

const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

const PASSWORD = 'secreto';
const FOLDER_NAME = 'privada';

let workspace = '';
let locked = '';

test.beforeEach(async ({ page }) => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-protect-'));
  locked = path.join(workspace, FOLDER_NAME);
  await fs.mkdir(locked);
  await fs.writeFile(path.join(locked, 'adentro.txt'), 'adentro\n', 'utf8');

  await seedSettings(page, { language: 'es' });
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

const pathBar = (page: Page) => page.locator('[data-path-bar]').nth(0);

/**
 * Types an absolute path into the left panel's path bar. A panel can still be
 * settling the path it opened with right after load, which would overwrite the
 * first try, so the action is repeated and the last one still has to pass.
 */
async function enterPath(page: Page, target: string) {
  const bar = pathBar(page);
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

/**
 * Opens the dialog the way a user does: the Help menu carries the command, and
 * it protects the panel's current folder.
 */
async function openProtectDialog(page: Page) {
  const title = page.getByRole('button', { name: 'Ayuda', exact: true }).first();
  await title.click();
  await title
    .locator('..')
    .getByRole('button', { name: /^Proteger Carpeta/ })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

interface StoredSettings {
  protectedFolders?: Record<string, { hash?: string; salt?: string }>;
}

const storedSettings = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: StoredSettings };
    // Settings are written in a versioned envelope; a bare object is what a
    // build from before it left behind, and the reader accepts both.
    return parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : (parsed as StoredSettings);
  }, SETTINGS_KEY);

/** The fields of the record stored for a folder, so a test can say what is there. */
const recordFields = async (page: Page, folder: string) => {
  const settings = await storedSettings(page);
  const record = settings?.protectedFolders?.[folder];
  return record ? Object.keys(record).sort().join(',') : null;
};

test('protecting a folder stores a hash, refuses bad input and can be undone', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  // The command protects the folder the panel is in, so the panel has to be in
  // it: what the dialog names has to be that folder and not the workspace.
  await enterPath(page, locked);
  await expect(page.locator('[data-name="adentro.txt"]').first()).toBeVisible();

  const dialog = await openProtectDialog(page);
  await expect(dialog).toContainText(FOLDER_NAME);
  await expect(dialog).toContainText('Protección de Carpeta con Contraseña');

  const password = dialog.locator('input[type="password"]').nth(0);
  const confirmation = dialog.locator('input[type="password"]').nth(1);
  const save = dialog.getByRole('button', { name: 'Proteger Carpeta' });

  // An empty form is refused without closing: the folder keeps its password or
  // its absence, and nothing is written.
  await expect(dialog.locator('input[type="password"]')).toHaveCount(2);
  await save.click();
  await expect(dialog.getByText('Por favor ingrese una contraseña válida')).toBeVisible();
  expect(await recordFields(page, locked)).toBe(null);

  // A typo in the confirmation is the case the two fields exist for.
  await password.fill(PASSWORD);
  await confirmation.fill(`${PASSWORD}2`);
  await save.click();
  await expect(dialog.getByText('Las contraseñas no coinciden')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await recordFields(page, locked)).toBe(null);

  // The typed password is derived off the click, so the record lands after the
  // dialog has closed: the assertion waits for it instead of for the click.
  await confirmation.fill(PASSWORD);
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => recordFields(page, locked)).toBe('hash,salt');

  // Settings are JSON in localStorage, which is what makes this worth asserting:
  // a plaintext password here is the one way the dialog could betray the user.
  const stored = await storedSettings(page);
  expect(JSON.stringify(stored)).not.toContain(PASSWORD);

  // Reopening proves the record is read back: the same folder now offers removal
  // instead of a second password.
  const reopened = await openProtectDialog(page);
  await expect(reopened.getByText('Esta carpeta ya se encuentra protegida')).toBeVisible();
  await expect(reopened.locator('input[type="password"]')).toHaveCount(0);

  await reopened.getByRole('button', { name: 'Quitar Protección de Contraseña' }).click();
  await expect(reopened).toHaveCount(0);
  await expect.poll(() => recordFields(page, locked)).toBe(null);

  // And the removal reaches the guard: out of the folder and back in with no
  // prompt and the contents on screen.
  await page.locator('[title="Directorio superior (Retroceso)"]').first().click();
  await expect(pathBar(page)).toContainText(path.basename(workspace));
  await page.locator(`[data-name="${FOLDER_NAME}"]`).first().dblclick();
  await expect(page.locator('[data-name="adentro.txt"]').first()).toBeVisible();
  await expect(page.getByText('Acceso Protegido por Contraseña')).toHaveCount(0);
});
