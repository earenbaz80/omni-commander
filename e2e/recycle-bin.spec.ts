import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeWorkspace } from './support/tempWorkspaces';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * The recycle bin window, walked from the header menu a user opens it from.
 *
 * It is the only way to undo a delete made inside the app, and nothing covered
 * it: the accessibility sweeps leave it out on purpose ("Papelera reads the real
 * recycle bin"), no unit test builds one, and the delete spec stops at the
 * folder. So its promises are checked here -- Restaurar puts the entry back, the
 * permanent delete takes it away, and the two buttons that act on the whole list
 * do all of it in one press -- with the bin seeded the way a previous run would
 * have left it.
 *
 * The window acts on the catalogue, not on bytes. For a drive the app manages, a
 * delete parks the entry under the app's own `TR:` drive and records it in
 * `nc_recycle_bin_v1`; restoring moves the entry back to its original drive and
 * path, and dropping it removes the record. Those two keys are what the cases
 * read, and a file in a scratch folder proves the window never goes near the
 * disk -- a bin that quietly deleted real files would be the worst version of
 * itself.
 */

/** Any original path will do: the window prints it and the restore copies it. */
const ORIGINAL_PATH = 'C:\\carpeta de prueba';
const RECYCLE_BIN_KEY = 'nc_recycle_bin_v1';
const FILES_KEY = 'nc_filesystem_v1';

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-bin-'));
  await fs.writeFile(path.join(workspace, 'intacto.txt'), 'intacto\n', 'utf8');
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

interface Entry {
  /** The id the file had before it was deleted, which is how a restore finds it. */
  id: string;
  /** Name shown in the window, without its extension. */
  name: string;
}

/**
 * Seeds the bin the way `moveToRecycleBin` leaves it: one record per deletion in
 * `nc_recycle_bin_v1`, and the file parked on the app's `TR:` drive. `kept` seeds
 * catalogue entries on a drive of their own, which are there to be left alone.
 * Both keys are written before the app loads, so the engine reads them at boot.
 */
async function seedBin(page: Page, entries: Entry[], kept: Entry[] = []) {
  const bin = entries.map(({ id, name }) => ({
    id: `trash_${id}`,
    originalId: id,
    originalPath: ORIGINAL_PATH,
    originalDriveId: 'drive_prueba',
    deletedAt: '2026-11-09 10:00:00',
    item: { id, name, ext: 'txt', path: 'TR:', driveId: 'drive_trash', isDirectory: false, size: 4 },
  }));
  const files = [
    ...entries.map(({ id, name }) => ({
      id,
      name,
      ext: 'txt',
      path: 'TR:',
      driveId: 'drive_trash',
      isDirectory: false,
      size: 4,
    })),
    ...kept.map(({ id, name }) => ({
      id,
      name,
      ext: 'txt',
      path: ORIGINAL_PATH,
      driveId: 'drive_prueba',
      isDirectory: false,
      size: 4,
    })),
  ];

  await page.addInitScript(
    (payload: { bin: unknown[]; files: unknown[] }) => {
      localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
      localStorage.setItem('nc_recycle_bin_v1', JSON.stringify(payload.bin));
      localStorage.setItem('nc_filesystem_v1', JSON.stringify(payload.files));
    },
    { bin, files },
  );
}

/**
 * Reads one of the catalogue keys. The app writes a versioned envelope and a
 * seeded value is bare, and the reader accepts both, so the helper does too.
 */
const readList = (page: Page, key: string) =>
  page.evaluate((storageKey: string) => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [] as Array<Record<string, unknown>>;
    const parsed = JSON.parse(raw) as unknown;
    const value = (parsed as { value?: unknown }).value ?? parsed;
    return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  }, key);

/** Opens Comandos -> Papelera de Reciclaje and returns the window it renders. */
async function openBin(page: Page) {
  await page.goto('/');

  // The menu title is chrome: it mounts before the boot resolves, so waiting for
  // it says nothing about the app behind it. A row is the real gate -- a drive
  // was confirmed and a folder was listed.
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  const commands = page.getByRole('button', { name: 'Comandos', exact: true }).first();
  await expect(commands).toBeVisible();
  await commands.click();
  await commands
    .locator('..')
    .getByRole('button', { name: /^Papelera de Reciclaje/ })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText(/Papelera de Reciclaje Virtual/);
  return dialog;
}

const isThere = async (name: string) => {
  try {
    await fs.access(path.join(workspace, name));
    return true;
  } catch {
    return false;
  }
};

test('the window lists what was deleted and Restaurar puts it back', async ({ page }) => {
  test.setTimeout(120000);
  await seedBin(page, [
    { id: 'f-restaurar', name: 'restaurar' },
    { id: 'f-borrar', name: 'borrar' },
  ]);

  const dialog = await openBin(page);

  // Both records, with the place each one came from: that path is the promise
  // the window makes about where a restore ends up.
  await expect(dialog).toContainText(/restaurar\.txt/i);
  await expect(dialog).toContainText(/borrar\.txt/i);
  await expect(dialog).toContainText(ORIGINAL_PATH);
  await expect(dialog).toContainText(/2\s*elementos en la papelera/);

  // The entries are listed in the order they were recorded, so the first
  // Restaurar belongs to the first record.
  await dialog.getByRole('button', { name: 'Restaurar', exact: true }).first().click();

  await expect.poll(async () => (await readList(page, RECYCLE_BIN_KEY)).length).toBe(1);
  const left = await readList(page, RECYCLE_BIN_KEY);
  expect(left.map((entry) => entry.id)).toEqual(['trash_f-borrar']);

  // The catalogue entry is back on the drive and the path it was taken from,
  // whichever way the engine got there -- moved back or re-created.
  await expect
    .poll(async () => {
      const files = await readList(page, FILES_KEY);
      const restored = files.find((file) => file.id === 'f-restaurar');
      return restored ? `${String(restored.driveId)}|${String(restored.path)}` : 'missing';
    })
    .toBe(`drive_prueba|${ORIGINAL_PATH}`);

  // Restoring is a record moving inside the app, not a file moving on disk.
  expect(await isThere('intacto.txt')).toBe(true);
});

test('the permanent delete drops the record and leaves the bin empty', async ({ page }) => {
  test.setTimeout(120000);
  await seedBin(page, [{ id: 'f-unico', name: 'unico' }]);

  const dialog = await openBin(page);
  await expect(dialog).toContainText(/unico\.txt/i);

  // The button is icon-only: its title is what names it, for a person and for
  // this locator alike.
  await dialog.getByTitle('Eliminar permanentemente').first().click();

  await expect.poll(async () => (await readList(page, RECYCLE_BIN_KEY)).length).toBe(0);
  await expect(dialog.getByText(/La Papelera de Reciclaje está vacía/)).toBeVisible();

  // The file record goes with it: an entry that stays in the catalogue would
  // show up in a listing as a file that no longer has a record anywhere.
  const files = await readList(page, FILES_KEY);
  expect(files.filter((file) => file.id === 'f-unico')).toHaveLength(0);

  expect(await isThere('intacto.txt'), 'a bin must never delete a real file').toBe(true);
});

test('Restaurar Todo puts every record back in one press', async ({ page }) => {
  test.setTimeout(120000);
  await seedBin(page, [
    { id: 'f-uno', name: 'uno' },
    { id: 'f-dos', name: 'dos' },
    { id: 'f-tres', name: 'tres' },
  ]);

  const dialog = await openBin(page);
  await expect(dialog).toContainText(/3\s*elementos en la papelera/);

  await dialog.getByRole('button', { name: 'Restaurar Todo' }).click();

  // One press, every record: a batch that stopped after the first would leave
  // an entry listed and a file still parked on the TR: drive.
  await expect.poll(async () => (await readList(page, RECYCLE_BIN_KEY)).length).toBe(0);
  await expect(dialog.getByText(/La Papelera de Reciclaje está vacía/)).toBeVisible();

  const files = await readList(page, FILES_KEY);
  expect(files.some((file) => String(file.driveId) === 'drive_trash')).toBe(false);

  // The catalogue also holds whatever the panels listed at boot, so the check
  // is about the three records that were ours.
  const ours = files.filter((file) => ['f-uno', 'f-dos', 'f-tres'].includes(String(file.id)));
  expect(ours).toHaveLength(3);
  expect(ours.every((file) => String(file.driveId) === 'drive_prueba' && String(file.path) === ORIGINAL_PATH)).toBe(
    true,
  );

  expect(await isThere('intacto.txt')).toBe(true);
});

test('Vaciar Papelera drops the records and nothing else', async ({ page }) => {
  test.setTimeout(120000);
  await seedBin(
    page,
    [
      { id: 'f-uno', name: 'uno' },
      { id: 'f-dos', name: 'dos' },
    ],
    [{ id: 'f-fuera', name: 'fuera' }],
  );

  const dialog = await openBin(page);
  await expect(dialog).toContainText(/2\s*elementos en la papelera/);

  await dialog.getByRole('button', { name: 'Vaciar Papelera' }).click();

  await expect.poll(async () => (await readList(page, RECYCLE_BIN_KEY)).length).toBe(0);
  await expect(dialog.getByText(/La Papelera de Reciclaje está vacía/)).toBeVisible();

  const files = await readList(page, FILES_KEY);
  expect(files.some((file) => String(file.driveId) === 'drive_trash')).toBe(false);
  // The button empties the bin, not the catalogue: a file that was never in it
  // has no business disappearing because someone emptied something else.
  const ids = files.map((file) => String(file.id));
  expect(ids).toContain('f-fuera');
  expect(ids).toEqual(expect.not.arrayContaining(['f-uno', 'f-dos']));

  expect(await isThere('intacto.txt'), 'emptying the bin must not delete a real file').toBe(true);
});
