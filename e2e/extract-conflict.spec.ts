import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Extracting over a name that is already taken, driven through the interface.
 *
 * The extraction used to resolve that collision by itself: the write refused the
 * second file and the task failed with a message about an existing name. It now
 * parks on a prompt and waits for an answer, so this case follows the whole
 * road -- context menu, parked extraction, prompt, overwrite, bytes on disk --
 * because each half of it is invisible from the other: the engine's own tests
 * never press the menu, and a menu test without a real name in the way never
 * reaches the prompt.
 *
 * The scratch folder holds the committed `sample.zip` (whose `a.txt` reads
 * `hola archivo`) next to an `a.txt` of its own with other bytes, which is
 * exactly the conflict: same name, different content, so replacing it has to be
 * the person's decision.
 */

const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

// Pin the UI language so the labels asserted below don't move with the default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

/** What the panel already has, and what the archive would put in its place. */
const OLD_BYTES = 'viejo\n';
const ARCHIVE_BYTES = 'hola archivo\n';

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-conflict-'));
  await fs.copyFile(path.resolve('test-fixtures/archives', 'sample.zip'), path.join(workspace, 'sample.zip'));
  await fs.writeFile(path.join(workspace, 'a.txt'), OLD_BYTES, 'utf8');
});

test.afterEach(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
});

/** Types an absolute path into one panel's path bar and submits it. */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  await page.locator('[data-path-bar]').nth(panel).click();
  // Only the path bar being edited renders this field, so there is exactly one.
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(target);
  await input.press('Enter');
}

/** The data row of the prompt's table that starts with the given label. */
function factRow(page: Page, label: string) {
  return page.locator('tr', { hasText: label });
}

test('asks before replacing an existing file and overwrites when told to', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');

  // The scratch folder lives on the drive the app has to be showing: the server
  // refuses a listing that points outside the panel's own drive.
  const drive = path.parse(workspace).root.replace(/[\\/]/g, '');
  const driveButton = page.getByRole('button', { name: `[${drive}]` });
  await expect(driveButton.first()).toBeVisible({ timeout: 90000 });
  await driveButton.first().click();
  await enterPath(page, 0, workspace);

  const archiveRow = page.locator('[data-name="sample.zip"]');
  await expect(archiveRow).toBeVisible({ timeout: 30000 });
  await archiveRow.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: 'Menú contextual' });
  await expect(menu).toBeVisible();
  // The extract submenu expands in place, so its destinations only exist after
  // the parent command has been clicked.
  await menu
    .getByRole('menuitem', { name: /^Extraer/ })
    .first()
    .click();
  await menu.getByRole('menuitem', { name: 'Extraer aquí' }).click();

  // The name is taken, so the run stops and asks instead of replacing the file.
  await expect(page.getByText('El destino ya existe: a.txt')).toBeVisible({ timeout: 60000 });
  expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe(OLD_BYTES);

  // Both sides of the decision are on screen: the member's own size against the
  // size of the file already there, and a real date for that file rather than a
  // dash the user would have to guess about.
  const sizeRow = factRow(page, 'Tamaño');
  await expect(sizeRow.locator('td').nth(1)).toHaveText('13 B');
  await expect(sizeRow.locator('td').nth(2)).toHaveText('6.0 B');
  const dateRow = factRow(page, 'Modificado');
  await expect(dateRow.locator('td').nth(1), 'the archive member has no date on the prompt').not.toHaveText('—');
  await expect(dateRow.locator('td').nth(2), 'the destination date was not reported').not.toHaveText('—');

  // One answer, for this file: the always variant is a separate radio.
  await expect(page.getByRole('radio', { name: 'Solo este archivo' })).toBeChecked();
  await page.getByRole('button', { name: 'Sobrescribir', exact: true }).click();

  // The prompt is gone and the member landed with the archive's bytes; the rest
  // of the archive followed it.
  await expect(page.getByText('El destino ya existe: a.txt')).toHaveCount(0, { timeout: 30000 });
  await expect
    .poll(async () => fs.readFile(path.join(workspace, 'a.txt'), 'utf8').catch(() => null), {
      timeout: 60000,
      message: 'the answered overwrite never replaced the file',
    })
    .toBe(ARCHIVE_BYTES);
  await expect
    .poll(async () => fs.readFile(path.join(workspace, 'sub', 'b.txt'), 'utf8').catch(() => null), {
      timeout: 60000,
      message: 'the extraction stopped at the conflict instead of finishing the archive',
    })
    .toBe('anidado en la carpeta\n');
});
