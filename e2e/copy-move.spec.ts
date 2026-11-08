import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import { removeWorkspace } from './support/tempWorkspaces';
import path from 'node:path';

/**
 * Copying and moving onto a destination that already holds the same name.
 *
 * The unit tests around the prompt can prove it renders a conflict and that a
 * payload resolves one. They cannot show the part that matters to a user: the
 * transfer parks *on disk* while the question is open, and the answer decides
 * what the two folders contain afterwards. So each case below starts at the file
 * list, presses the shortcut a person presses, answers the real prompt, and then
 * reads both folders back.
 *
 * "Preguntar" is never the default policy — the app defaults to overwriting —
 * so the spec has to choose it, exactly like a user who does not want files
 * replaced without being told would.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

// Pin the UI language so the labels clicked below don't move with the default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

// Separate sizes on purpose: the prompt has to show both numbers, so they must
// not be interchangeable. 16 bytes and 6 bytes format differently ("16 B" and
// "6.0 B"), which is what the assertions look for.
const NEWEST = 'contenido nuevo\n';
const OLDEST = 'viejo\n';
const MOVED = 'viaja\n';
const KEPT = 'se queda\n';

let leftDir = '';
let rightDir = '';

test.beforeEach(async () => {
  leftDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-cm-l-'));
  rightDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-cm-r-'));

  await fs.writeFile(path.join(leftDir, 'nota.txt'), NEWEST, 'utf8');
  await fs.writeFile(path.join(rightDir, 'nota.txt'), OLDEST, 'utf8');
  await fs.writeFile(path.join(leftDir, 'mover.txt'), MOVED, 'utf8');
  await fs.writeFile(path.join(rightDir, 'mover.txt'), KEPT, 'utf8');
});

test.afterEach(async () => {
  for (const dir of [leftDir, rightDir]) {
    if (dir) await removeWorkspace(dir);
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

/** Points the panels at the two scratch folders and waits for their listings. */
async function openPanels(page: Page) {
  await page.goto('/');
  await enterPath(page, 0, leftDir);
  await enterPath(page, 1, rightDir);
  await expect(page.locator('[data-name="nota.txt"]').first()).toBeVisible();
  // The right panel holds the same names, so it has to be checked by its own
  // copy of the row rather than by a count.
  await expect(page.locator('[data-name="mover.txt"]')).toHaveCount(2);
}

/**
 * Clicks the left panel's row for `name`. Both panels hold the same names, and
 * the left one renders first, which is how the archive spec addresses the panel
 * it means too.
 */
async function focusRow(page: Page, name: string) {
  await page.locator(`[data-name="${name}"]`).first().click();
}

/** Reads a file, treating "not there" as no value so `poll` can retry. */
async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Opens the transfer window with F5 or F6, switches the collision policy to
 * "ask" and starts the job. Returns the conflict prompt that the run must raise.
 */
async function startTransferAsking(page: Page, op: 'copy' | 'move') {
  await page.keyboard.press(op === 'copy' ? 'F5' : 'F6');

  // The transfer window is titled by the operation it will perform, which keeps
  // it apart from the conflict prompt that shows up over it a moment later.
  const window = page.getByRole('dialog', { name: op === 'copy' ? 'Copiar Archivos' : 'Mover / Renombrar' });
  await expect(window).toBeVisible({ timeout: 30000 });

  // The destination is prefilled with the other panel, which is the folder the
  // panels were pointed at above.
  await expect(window.getByText('Ruta de Destino:')).toBeVisible();
  await expect(window.locator('input[type="text"]')).toHaveValue(rightDir);

  await window.getByRole('radio', { name: 'Preguntar', exact: true }).check();
  await window.getByRole('button', { name: op === 'copy' ? 'Copiar (Enter)' : 'Mover (Enter)' }).click();

  // Exactly one dialog carries this name. The shell owns the role and the focus
  // trap; when the body claimed them too, the prompt was announced twice.
  const prompt = page.getByRole('dialog', { name: 'El destino ya existe' });
  await expect(prompt).toHaveCount(1, { timeout: 60000 });
  await expect(prompt).toBeVisible();
  return prompt;
}

/**
 * The clipboard is how Windows copies and moves, and the app had no keys for it:
 * Ctrl+C and Ctrl+V did nothing, so anyone trained on Explorer could not copy
 * from it at all. These cases press the real keys through the real interface and
 * read the folders back, which is the only way to tell a paste from a dialog that
 * merely looks right.
 */
test('copies with Ctrl+C and Ctrl+V into the folder in front of the user', async ({ page }) => {
  await fs.writeFile(path.join(rightDir, 'nuevo.txt'), NEWEST, 'utf8');
  await openPanels(page);

  // Selecting in the right panel makes it the active one.
  await page.locator('[data-name="nuevo.txt"]').click();
  await page.keyboard.press('Control+c');

  // Move to the left panel and paste: the target is the folder being looked at,
  // not the other panel, which is what F5 does.
  await page.locator('[data-name="mover.txt"]').first().click();
  await page.keyboard.press('Control+v');

  await expect.poll(() => readIfPresent(path.join(leftDir, 'nuevo.txt'))).toBe(NEWEST);
  // A copy leaves the original where it was.
  await expect.poll(() => readIfPresent(path.join(rightDir, 'nuevo.txt'))).toBe(NEWEST);
});

test('cuts with Ctrl+X and the paste moves the file instead of copying it', async ({ page }) => {
  await fs.writeFile(path.join(rightDir, 'recorte.txt'), MOVED, 'utf8');
  await openPanels(page);

  await page.locator('[data-name="recorte.txt"]').click();
  await page.keyboard.press('Control+x');
  await page.locator('[data-name="mover.txt"]').first().click();
  await page.keyboard.press('Control+v');

  await expect.poll(() => readIfPresent(path.join(leftDir, 'recorte.txt'))).toBe(MOVED);
  // A cut removes the source; a copy would still be there.
  await expect.poll(() => readIfPresent(path.join(rightDir, 'recorte.txt'))).toBeNull();
});

test('asks before replacing a file and then overwrites only that one', async ({ page }) => {
  await openPanels(page);
  await focusRow(page, 'nota.txt');

  const prompt = await startTransferAsking(page, 'copy');

  // Both sides, named and measured: a dialog that only said "this exists" would
  // still force a blind choice between replacing and skipping.
  await expect(prompt).toContainText(path.join(leftDir, 'nota.txt'));
  await expect(prompt).toContainText(path.join(rightDir, 'nota.txt'));
  await expect(prompt.getByRole('cell', { name: '16 B', exact: true })).toBeVisible();
  await expect(prompt.getByRole('cell', { name: '6.0 B', exact: true })).toBeVisible();

  await prompt.getByRole('button', { name: 'Sobrescribir', exact: true }).click();
  await expect(prompt).toHaveCount(0);

  // The answer reached the disk: the destination now holds the source bytes.
  await expect.poll(() => readIfPresent(path.join(rightDir, 'nota.txt'))).toBe(NEWEST);

  // A copy keeps its source, and "overwrite" replaced instead of writing a
  // second copy beside the old one.
  expect(await readIfPresent(path.join(leftDir, 'nota.txt'))).toBe(NEWEST);
  expect((await fs.readdir(rightDir)).sort()).toEqual(['mover.txt', 'nota.txt']);
});

test('moves onto a collision as a new name when told to keep both', async ({ page }) => {
  await openPanels(page);
  await focusRow(page, 'mover.txt');

  const prompt = await startTransferAsking(page, 'move');

  await prompt.getByRole('button', { name: 'Conservar ambos', exact: true }).click();
  await expect(prompt).toHaveCount(0);

  // "Keep both" renames the incoming file, never the one already there.
  await expect.poll(() => readIfPresent(path.join(rightDir, 'mover (2).txt'))).toBe(MOVED);
  expect(await readIfPresent(path.join(rightDir, 'mover.txt'))).toBe(KEPT);

  // And it was a move: the source is gone, which is what separates this case
  // from the copy above.
  await expect.poll(() => readIfPresent(path.join(leftDir, 'mover.txt'))).toBeNull();
  expect(await readIfPresent(path.join(leftDir, 'nota.txt'))).toBe(NEWEST);
  expect((await fs.readdir(leftDir)).sort()).toEqual(['nota.txt']);
});
