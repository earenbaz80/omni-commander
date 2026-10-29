import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Folder sync, driven through the menu and checked against the disk.
 *
 * The modal compares the two panels and then copies through the engine, which on
 * a real drive is a server write. Unit coverage can prove the diff table given
 * two item lists; it cannot prove the run wrote a byte anywhere. So this spec
 * builds two folders whose differences it knows, opens the dialog the way a user
 * does, and then reads the files back from disk: the copied ones must hold the
 * source bytes, and the skipped one must not exist at all.
 *
 * A detail worth knowing: the dialog keys entries by name plus extension, and
 * the server splits `solo-izq.txt` into name `solo-izq` and extension `TXT`, so
 * the row hook the spec reads is `data-sync-name="solo-izq"`.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

// Pin the UI language so the labels read below don't move with the default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

const LEFT_ONLY = 'solo existe en la izquierda\n';
const RIGHT_ONLY = 'solo existe en la derecha\n';
const SKIPPED = 'este no debe viajar\n';
const SHARED = 'igual en los dos lados\n';
/** Both copies of the shared file get this time, so it counts as identical. */
const SHARED_TIME = new Date('2021-03-04T05:06:07Z');

let leftDir = '';
let rightDir = '';

test.beforeEach(async () => {
  leftDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-sync-l-'));
  rightDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-sync-r-'));

  await fs.writeFile(path.join(leftDir, 'solo-izq.txt'), LEFT_ONLY, 'utf8');
  await fs.writeFile(path.join(leftDir, 'omitir.txt'), SKIPPED, 'utf8');
  await fs.writeFile(path.join(leftDir, 'comun.txt'), SHARED, 'utf8');
  await fs.writeFile(path.join(rightDir, 'solo-der.txt'), RIGHT_ONLY, 'utf8');
  await fs.writeFile(path.join(rightDir, 'comun.txt'), SHARED, 'utf8');

  // Same size and same time: the only way the shared file can be reported as
  // identical instead of "newer on one side".
  await fs.utimes(path.join(leftDir, 'comun.txt'), SHARED_TIME, SHARED_TIME);
  await fs.utimes(path.join(rightDir, 'comun.txt'), SHARED_TIME, SHARED_TIME);
});

test.afterEach(async () => {
  for (const dir of [leftDir, rightDir]) {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Types an absolute path into one panel's path bar and submits it. */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  await page.locator('[data-path-bar]').nth(panel).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(target);
  await input.press('Enter');
}

/** Reads a file, treating "not there yet" as no value so `poll` can retry. */
async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Points the panels at the two folders and opens the sync dialog from the
 * Commands menu, which is where a user finds it.
 */
async function openSync(page: Page): Promise<Locator> {
  await page.goto('/');
  await enterPath(page, 0, leftDir);
  await enterPath(page, 1, rightDir);

  // Both listings have to be on screen before the dialog copies them into its
  // comparison; waiting for the rows is waiting for the panels, not for a delay.
  await expect(page.locator('[data-name="solo-izq.txt"]')).toBeVisible();
  await expect(page.locator('[data-name="solo-der.txt"]')).toBeVisible();

  await page.getByRole('button', { name: 'Comandos', exact: true }).click();
  await page.getByRole('button', { name: /Sincronizar Carpetas/ }).click();

  // Named by the heading the window shows, which is what `ModalShell` publishes
  // as the accessible name. It used to be labelled with the menu entry instead,
  // because the body claimed its own dialog on top of the shell's.
  const dialog = page.getByRole('dialog', { name: 'Sincronizador de Directorios & Novedades' });
  await expect(dialog).toBeVisible();
  // The dialog must be comparing the two folders the panels are showing.
  await expect(dialog).toContainText(leftDir);
  await expect(dialog).toContainText(rightDir);
  return dialog;
}

test('lists what differs between the panels and hides what is equal', async ({ page }) => {
  const dialog = await openSync(page);

  const leftOnly = dialog.locator('[data-sync-name="solo-izq"]');
  await expect(leftOnly).toHaveCount(1);
  await expect(leftOnly).toHaveAttribute('data-sync-status', 'LEFT_ONLY');
  await expect(leftOnly).toHaveAttribute('data-sync-direction', 'L_TO_R');
  await expect(leftOnly).toContainText('Solo en Izq');

  const rightOnly = dialog.locator('[data-sync-name="solo-der"]');
  await expect(rightOnly).toHaveCount(1);
  await expect(rightOnly).toHaveAttribute('data-sync-status', 'RIGHT_ONLY');
  await expect(rightOnly).toHaveAttribute('data-sync-direction', 'R_TO_L');
  await expect(rightOnly).toContainText('Solo en Der');

  // Identical file, hidden by the default filter: it is not a difference.
  await expect(dialog.locator('[data-sync-name="comun"]')).toHaveCount(0);

  await dialog.getByLabel('Ocultar Idénticos').uncheck();
  const identical = dialog.locator('[data-sync-name="comun"]');
  await expect(identical).toHaveCount(1);
  await expect(identical).toHaveAttribute('data-sync-status', 'EQUAL');
  await expect(identical).toHaveAttribute('data-sync-direction', 'SKIP');
  await expect(identical).toContainText('Idéntico');
});

test('copies the marked items in both directions and leaves the skipped one alone', async ({ page }) => {
  const sharedBefore = await fs.stat(path.join(rightDir, 'comun.txt'));

  const dialog = await openSync(page);

  // Marking is per row: L_TO_R, then R_TO_L, then skip. This file is the only
  // left-only entry that must not travel, so it proves the run honours the mark.
  const skipped = dialog.locator('[data-sync-name="omitir"]');
  const toggle = skipped.getByRole('button');
  await toggle.click();
  await toggle.click();
  await expect(skipped).toHaveAttribute('data-sync-direction', 'SKIP');

  await dialog.getByRole('button', { name: 'Ejecutar Sincronización' }).click();
  await expect(dialog).toHaveCount(0);

  // Real writes: the bytes each source held, on the other side.
  await expect.poll(() => readIfPresent(path.join(rightDir, 'solo-izq.txt'))).toBe(LEFT_ONLY);
  await expect.poll(() => readIfPresent(path.join(leftDir, 'solo-der.txt'))).toBe(RIGHT_ONLY);

  // The skipped file stayed home, and the run created nothing else.
  expect((await fs.readdir(rightDir)).sort()).toEqual(['comun.txt', 'solo-der.txt', 'solo-izq.txt']);
  expect((await fs.readdir(leftDir)).sort()).toEqual(['comun.txt', 'omitir.txt', 'solo-der.txt', 'solo-izq.txt']);

  // Identical entries are left untouched, not rewritten with fresh timestamps.
  const sharedAfter = await fs.stat(path.join(rightDir, 'comun.txt'));
  expect(sharedAfter.mtimeMs).toBe(sharedBefore.mtimeMs);
  expect(await readIfPresent(path.join(rightDir, 'comun.txt'))).toBe(SHARED);
  expect(await readIfPresent(path.join(leftDir, 'comun.txt'))).toBe(SHARED);
});
