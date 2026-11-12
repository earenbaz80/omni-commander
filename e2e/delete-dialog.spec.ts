import { test, expect, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/services/storage';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeWorkspace } from './support/tempWorkspaces';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * The window that deletes files, walked from the list a user works in.
 *
 * F8 is the one action in the app that removes the user's data, and until this
 * spec the only things looking at it were the accessibility sweeps: they open it
 * and check that its controls are named and focus stays inside. The unit test
 * around `handleConfirmDelete` goes one step further and proves a task is
 * queued. Neither of them ever asks the question that matters -- did the file
 * disappear, and did anything else? -- so the answers are checked here against
 * the scratch folder on disk, not against the list the app draws.
 *
 * The setting behind it is a fork nobody had walked either: `useRecycleBin`
 * decides whether the server moves the entry to the Windows Recycle Bin or
 * removes it for good. The last case runs the permanent branch and pins the one
 * consequence the app owns: a real drive is never duplicated into the app's own
 * virtual bin, which only exists for the drives it keeps in settings.
 *
 * What this does not check, on purpose: whether Windows really holds the file
 * afterwards. That lives in `$Recycle.Bin`, which is not readable without the
 * elevation this suite is not allowed to ask for, so the trash side is covered
 * by the documented rule above rather than by looking at the bin.
 */

const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

/**
 * How long the folder may take to lose a file once the window is confirmed.
 *
 * The delete runs as a queued server job, so Playwright's five-second default
 * for `expect.poll` measures the queue, the server and -- on the Recycle Bin
 * branch -- the shell call that moves the file, not just the app. A full local
 * run on 2026-11-10 spent more than those five seconds on `uno.txt` and failed
 * while the same case passed alone and in CI on the same commit, which makes
 * five seconds the machine's budget rather than the app's.
 *
 * 30 s is the wait the rest of the suite gives a queued job, and it leaves the
 * case's own 120 s timeout room to fail on the right assertion.
 */
const DELETION_TIMEOUT_MS = 30_000;

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-delete-'));
  await fs.writeFile(path.join(workspace, 'uno.txt'), 'uno\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'dos.txt'), 'dos\n', 'utf8');
  // Never selected: what proves a delete took the selection and not the folder.
  await fs.writeFile(path.join(workspace, 'intacto.txt'), 'intacto\n', 'utf8');
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

/** Pins the language and, when a case needs it, the Recycle Bin setting. */
async function seedSettings(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ key, seed }: { key: string; seed: Record<string, unknown> }) => {
      localStorage.setItem(key, JSON.stringify(seed));
    },
    { key: SETTINGS_KEY, seed: { language: 'es', ...settings } },
  );
}

/** Points the left panel at the scratch folder and waits for its rows. */
async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  await page.locator('[data-path-bar]').nth(0).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(workspace);
  await input.press('Enter');

  await expect(page.locator('[data-name="uno.txt"]').first()).toBeVisible();
  await expect(page.locator('[data-name="intacto.txt"]').first()).toBeVisible();
}

/**
 * Marks rows with the selection box each row carries: the box reports its own
 * state through `aria-pressed`, so a case fails on the selection itself instead
 * of on whatever the window shows afterwards. The other way in, ctrl-clicking
 * the row, has its own case at the end.
 */
async function selectRows(page: Page, names: string[]) {
  for (const name of names) {
    const toggle = page.locator(`[data-name="${name}"]`).first().locator('button[aria-pressed]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
}

/**
 * Presses F8 with the list focused and returns the window that opened. The list
 * already has focus after the click that selected the rows, which is why this
 * does not focus anything itself -- pressing the key anywhere else is a
 * different code path, and not the one a user takes.
 */
async function openDelete(page: Page) {
  await page.keyboard.press('F8');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
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

/** Entries the app's own recycle bin holds, for the drives it manages itself. */
const virtualBinCount = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('nc_recycle_bin_v1');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    const value = (parsed as { value?: unknown }).value ?? parsed;
    return Array.isArray(value) ? value.length : 0;
  });

test('cancelling the delete window leaves every file where it was', async ({ page }) => {
  test.setTimeout(120000);
  await seedSettings(page);
  await openWorkspace(page);

  await selectRows(page, ['uno.txt', 'dos.txt']);
  const dialog = await openDelete(page);

  // The window has to be about the selection: both names, and not the neighbour.
  // The extension is upper-cased in this window, so the names ignore case.
  await expect(dialog).toContainText(/uno\.txt/i);
  await expect(dialog).toContainText(/dos\.txt/i);
  await expect(dialog).not.toContainText(/intacto/i);
  await expect(dialog).toContainText(/2 elemento\(s\)/);

  await dialog.getByRole('button', { name: /\(Esc\)/ }).click();
  await expect(dialog).toHaveCount(0);

  // Closing the prompt is a promise about the disk, not about the dialog.
  expect(await isThere('uno.txt')).toBe(true);
  expect(await isThere('dos.txt')).toBe(true);
  expect(await isThere('intacto.txt')).toBe(true);
});

test('confirming removes the selected files and nothing else', async ({ page }) => {
  test.setTimeout(120000);
  await seedSettings(page);
  await openWorkspace(page);

  await selectRows(page, ['uno.txt', 'dos.txt']);
  const dialog = await openDelete(page);
  // Both, before a byte is deleted: otherwise a failure below could be the
  // selection and not the deletion.
  await expect(dialog).toContainText(/uno\.txt/i);
  await expect(dialog).toContainText(/dos\.txt/i);

  await dialog.getByRole('button', { name: /\(Enter\)/ }).click();
  await expect(dialog).toHaveCount(0);

  // The delete runs as a queued server job, so the folder is read until it does.
  await expect.poll(() => isThere('uno.txt'), { timeout: DELETION_TIMEOUT_MS }).toBe(false);
  await expect.poll(() => isThere('dos.txt'), { timeout: DELETION_TIMEOUT_MS }).toBe(false);

  expect(await isThere('intacto.txt'), 'a delete must not take the whole folder').toBe(true);
  await expect(page.locator('[data-name="intacto.txt"]').first()).toBeVisible();
  await expect(page.locator('[data-name="uno.txt"]')).toHaveCount(0);

  // A real drive is trashed by the server; the app's virtual bin is for the
  // drives it owns, and duplicating the entry there would be a second, false
  // record of a file that is no longer in the folder.
  expect(await virtualBinCount(page)).toBe(0);
});

test('with the Recycle Bin off the file still goes, and never into the virtual bin', async ({ page }) => {
  test.setTimeout(120000);
  await seedSettings(page, { useRecycleBin: false });
  await openWorkspace(page);

  expect(await virtualBinCount(page)).toBe(0);

  await selectRows(page, ['uno.txt']);
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: /\(Enter\)/ }).click();
  await expect(dialog).toHaveCount(0);

  // Turning the bin off switches the server to a permanent removal, and the
  // folder has to end up the same: gone, with the rest untouched.
  await expect.poll(() => isThere('uno.txt'), { timeout: DELETION_TIMEOUT_MS }).toBe(false);
  expect(await isThere('dos.txt')).toBe(true);
  expect(await isThere('intacto.txt')).toBe(true);
  expect(await virtualBinCount(page)).toBe(0);
});

test('ctrl-click builds the selection the window acts on', async ({ page }) => {
  test.setTimeout(120000);
  await seedSettings(page);
  await openWorkspace(page);

  const row = (name: string) => page.locator(`[data-name="${name}"]`).first();
  const box = (name: string) => row(name).locator('button[aria-pressed]');

  // A plain click moves the cursor and leaves the selection alone, so the
  // modifier is the only thing that can build one here.
  await row('uno.txt').click();
  await expect(box('uno.txt')).toHaveAttribute('aria-pressed', 'false');

  await row('uno.txt').click({ modifiers: ['Control'] });
  await row('dos.txt').click({ modifiers: ['Control'] });
  await expect(box('uno.txt')).toHaveAttribute('aria-pressed', 'true');
  await expect(box('dos.txt')).toHaveAttribute('aria-pressed', 'true');

  // The same gesture takes a row back out; a toggle that could only add would
  // be a selection a user cannot shrink.
  await row('dos.txt').click({ modifiers: ['Control'] });
  await expect(box('dos.txt')).toHaveAttribute('aria-pressed', 'false');
  await row('dos.txt').click({ modifiers: ['Control'] });
  await expect(box('dos.txt')).toHaveAttribute('aria-pressed', 'true');

  const dialog = await openDelete(page);
  await expect(dialog).toContainText(/uno\.txt/i);
  await expect(dialog).toContainText(/dos\.txt/i);
  await expect(dialog).toContainText(/2 elemento\(s\)/);
  await expect(dialog).not.toContainText(/intacto/i);

  await dialog.getByRole('button', { name: /\(Esc\)/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(await isThere('uno.txt')).toBe(true);
  expect(await isThere('dos.txt')).toBe(true);
});
