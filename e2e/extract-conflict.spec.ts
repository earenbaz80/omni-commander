import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

/**
 * Extracting over names that are already taken, driven through the interface.
 *
 * The extraction used to resolve that collision by itself: the write refused the
 * second file and the task failed with a message about an existing name. It now
 * parks on a prompt and waits for an answer, so these cases follow the whole
 * road -- context menu, parked extraction, prompt, answer, bytes on disk --
 * because each half of it is invisible from the other: the engine's own tests
 * never press the menu, and a menu test without a real name in the way never
 * reaches the prompt.
 *
 * One case per answer that changes where the bytes go: replacing the file,
 * keeping both under a second name, and one answer standing for every later
 * taken name in the run. The scratch folder holds the committed `sample.zip`
 * (whose `a.txt` reads `hola archivo` and whose `sub/b.txt` reads `anidado en
 * la carpeta`) next to files of its own with other bytes, which is exactly the
 * conflict: same name, different content, so what happens to either side has to
 * be the person's decision.
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
const OLD_NESTED = 'viejo anidado\n';
const ARCHIVE_BYTES = 'hola archivo\n';
const ARCHIVE_NESTED = 'anidado en la carpeta\n';

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-conflict-'));
  await fs.copyFile(path.resolve('test-fixtures/archives', 'sample.zip'), path.join(workspace, 'sample.zip'));
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

/**
 * Points the left panel at the scratch folder and asks it to extract the ZIP
 * beside it, which is the only road that raises the prompt: the copy shortcut
 * extracts too, but through a path that never asks.
 */
async function extractHere(page: Page) {
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
}

/** The prompt's headline for one member, which names the member it stopped on. */
function prompt(page: Page, name: string) {
  return page.getByText(`El destino ya existe: ${name}`);
}

/** The data row of the prompt's table that starts with the given label. */
function factRow(page: Page, label: string) {
  return page.locator('tr', { hasText: label });
}

/** The date an archive states for one of its members, as the panel reads it. */
async function zipMemberDate(archive: string, member: string): Promise<Date> {
  const zip = await JSZip.loadAsync(await fs.readFile(path.resolve('test-fixtures/archives', archive)));
  const entry = zip.files[member];
  if (!entry) throw new Error(`${archive} has no ${member}`);
  return entry.date;
}

/** Waits for a file in the scratch folder to hold the bytes the archive carries. */
function landsWith(file: string, bytes: string, what: string) {
  return expect
    .poll(async () => fs.readFile(path.join(workspace, file), 'utf8').catch(() => null), {
      timeout: 60000,
      message: what,
    })
    .toBe(bytes);
}

test('asks before replacing an existing file and overwrites when told to', async ({ page }) => {
  test.setTimeout(240000);
  await fs.writeFile(path.join(workspace, 'a.txt'), OLD_BYTES, 'utf8');
  await page.goto('/');
  await extractHere(page);

  // The name is taken, so the run stops and asks instead of replacing the file.
  await expect(prompt(page, 'a.txt')).toBeVisible({ timeout: 60000 });
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
  await expect(prompt(page, 'a.txt')).toHaveCount(0, { timeout: 30000 });
  await landsWith('a.txt', ARCHIVE_BYTES, 'the answered overwrite never replaced the file');
  await landsWith(
    path.join('sub', 'b.txt'),
    ARCHIVE_NESTED,
    'the extraction stopped at the conflict instead of finishing the archive',
  );
});

test('keeps both under the next free name when told to keep both', async ({ page }) => {
  test.setTimeout(240000);
  await fs.writeFile(path.join(workspace, 'a.txt'), OLD_BYTES, 'utf8');
  await page.goto('/');
  await extractHere(page);

  await expect(prompt(page, 'a.txt')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Conservar ambos' }).click();

  // Neither side is lost: the file that was there keeps its bytes, and the
  // member lands beside it under the first name nobody held.
  await landsWith('a (2).txt', ARCHIVE_BYTES, 'the member never landed under a free name');
  expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe(OLD_BYTES);
  await landsWith(
    path.join('sub', 'b.txt'),
    ARCHIVE_NESTED,
    'the extraction stopped after keeping both instead of finishing the archive',
  );
});

test('applies one always answer to every later member with a taken name', async ({ page }) => {
  test.setTimeout(240000);
  // Both names the archive carries are taken here, so the run meets a second
  // conflict inside the same extraction instead of at the next one.
  await fs.writeFile(path.join(workspace, 'a.txt'), OLD_BYTES, 'utf8');
  await fs.mkdir(path.join(workspace, 'sub'));
  await fs.writeFile(path.join(workspace, 'sub', 'b.txt'), OLD_NESTED, 'utf8');
  await page.goto('/');
  await extractHere(page);

  await expect(prompt(page, 'a.txt')).toBeVisible({ timeout: 60000 });

  // The always variant is what makes the second taken name skip the question.
  await page.getByRole('radio', { name: /^Siempre/ }).check();
  await expect(page.getByRole('radio', { name: /^Siempre/ })).toBeChecked();
  await page.getByRole('button', { name: 'Sobrescribir', exact: true }).click();

  // The first member followed the answer, and `sub\b.txt` too: had the always
  // variant not been carried, that one would be parked on a prompt of its own
  // and its bytes would still be the old ones.
  await landsWith('a.txt', ARCHIVE_BYTES, 'the answered overwrite never replaced the first member');
  await landsWith(
    path.join('sub', 'b.txt'),
    ARCHIVE_NESTED,
    'the second taken name was not decided by the same always answer',
  );
  await expect(page.getByText(/^El destino ya existe: /)).toHaveCount(0);
});

test('leaves an identical file untouched when told to skip identical ones', async ({ page }) => {
  test.setTimeout(240000);
  // A copy of the member, dated exactly as the archive states it: that is what
  // "identical" means, and that date is what a rewrite would move.
  const memberDate = await zipMemberDate('sample.zip', 'a.txt');
  await fs.writeFile(path.join(workspace, 'a.txt'), ARCHIVE_BYTES, 'utf8');
  await fs.utimes(path.join(workspace, 'a.txt'), memberDate, memberDate);
  const before = (await fs.stat(path.join(workspace, 'a.txt'))).mtimeMs;
  await page.goto('/');
  await extractHere(page);

  await expect(prompt(page, 'a.txt')).toBeVisible({ timeout: 60000 });
  // The prompt says the answer would change nothing, because it compares the
  // member's own date and no longer stops at the size.
  await expect(
    page.getByText('Ambos archivos tienen el mismo tamaño y fecha; sobrescribir no cambia nada.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sobrescribir si es distinto' }).click();

  // The rest of the archive lands, and the identical member kept both its bytes
  // and the date it already had: a rewrite would have moved that date to now.
  await landsWith(path.join('sub', 'b.txt'), ARCHIVE_NESTED, 'the extraction stopped instead of finishing the archive');
  expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe(ARCHIVE_BYTES);
  expect((await fs.stat(path.join(workspace, 'a.txt'))).mtimeMs).toBe(before);
});
