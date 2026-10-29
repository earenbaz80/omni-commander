import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Where focus lands when a window opens, and where it goes back to when the
 * window closes.
 *
 * Both are `ModalShell`'s job: it names its panel, marks it modal, keeps Tab
 * inside it and restores whatever had focus before mounting. Every modal used to
 * ask for that a second time on a panel nested inside the shell's, and those
 * duplicate hooks were removed — so this spec is the check that removing them
 * left no window opening with focus nowhere, or with two traps fighting over
 * the same Tab.
 *
 * The assertions read `document.activeElement` and describe it, so a failure
 * says which element took focus rather than "focus was wrong".
 *
 * Two families of window are covered: the ones a key opens on its own, and the
 * ones that only make sense with a file focused first (copy, move, delete).
 * View and edit (F3, F4) are not here because a viewer that reads a file and an
 * editor that writes one are their own subjects.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-focus-'));
  await fs.writeFile(path.join(workspace, 'nota.txt'), 'una nota\n', 'utf8');
});

test.afterEach(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
});

interface FocusInfo {
  tag: string;
  text: string;
  insideDialog: boolean;
  named: boolean;
}

/** Everything a failure message needs about whatever holds focus right now. */
async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: el ? el.tagName.toLowerCase() : 'none', text: '', insideDialog: false, named: false };
    }
    // An icon-only button is named by its title as much as by its text, and the
    // toolbar is full of them, so all three sources count for the message.
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    // A text field is named by its associated label, which is not textContent.
    const labelledBy = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const associated = labelledBy ? (labelledBy.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return {
      tag: el.tagName.toLowerCase(),
      text: (label || associated).slice(0, 60),
      insideDialog: !!el.closest('[role="dialog"]'),
      named: label.length > 0 || associated.length > 0,
    };
  });
}

/** Points the left panel at the scratch folder and focuses the file in it. */
async function focusFile(page: Page) {
  await page.locator('[data-path-bar]').nth(0).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(workspace);
  await input.press('Enter');

  const row = page.locator('[data-name="nota.txt"]').first();
  await expect(row).toBeVisible();
  await row.click();
}

/**
 * Windows that a person opens with a key. `file` marks the ones whose subject is
 * the focused entry: without something under the cursor, copy, move and delete
 * have nothing to act on.
 */
const KEY_WINDOWS: Array<{ label: string; key: string; file?: boolean }> = [
  { label: 'help', key: 'F1' },
  { label: 'user menu', key: 'F2' },
  { label: 'new folder', key: 'F7' },
  { label: 'search and grep', key: 'Alt+F7' },
  { label: 'copy', key: 'F5', file: true },
  { label: 'move', key: 'F6', file: true },
  { label: 'delete', key: 'F8', file: true },
];

for (const win of KEY_WINDOWS) {
  test(`focus enters the ${win.label} window and stays inside it`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-name]').first()).toBeVisible();
    if (win.file) await focusFile(page);

    await page.keyboard.press(win.key);

    // One dialog, not two: the shell owns it and the body no longer claims one.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();

    // Effects run after the commit that renders the window, and the copy/move
    // window moves focus to its destination field one tick later, so this waits
    // for focus to be inside instead of reading it at whatever moment the key
    // press returned.
    await expect
      .poll(async () => (await focusInfo(page)).insideDialog, {
        message: `the ${win.label} window never took focus`,
      })
      .toBe(true);

    const landed = await focusInfo(page);
    expect(landed, `the ${win.label} window opened with focus on <${landed.tag}> "${landed.text}"`).toMatchObject({
      insideDialog: true,
      named: true,
    });
    // A focused container would technically be "inside" while telling a screen
    // reader nothing, so the landing spot has to be a real control.
    expect(['button', 'input', 'select', 'textarea', 'a']).toContain(landed.tag);

    // Tab is trapped by the shell's own panel, which still wraps the body.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await focusInfo(page)).toMatchObject({ insideDialog: true });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('closing a window hands focus back to the control that opened it', async ({ page }) => {
  await page.goto('/');

  const opener = page.getByTitle('Configuración');
  await expect(opener).toBeVisible({ timeout: 60000 });
  await opener.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  expect(await focusInfo(page)).toMatchObject({ insideDialog: true });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The shell remembered the opener on mount and put focus back on unmount;
  // without that, the next keystroke would land on the document body.
  const back = await focusInfo(page);
  expect(back.insideDialog, `focus ended on <${back.tag}> "${back.text}"`).toBe(false);
  await expect(opener, 'the control that opened the window has to be the one focused again').toBeFocused();
});

test('the copy window opens with focus on its destination field', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible();
  await focusFile(page);

  await page.keyboard.press('F5');
  const dialog = page.getByRole('dialog', { name: 'Copiar Archivos' });
  await expect(dialog).toBeVisible({ timeout: 30000 });

  // Not just "somewhere inside": the field is where the next keystroke goes, and
  // it has to be able to say what it is when it gets there.
  const destination = dialog.getByLabel('Ruta de Destino:');
  await expect(destination).toBeFocused();
  // The other panel's path is prefilled, so the field is usable as it opens.
  await expect(destination).not.toHaveValue('');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
