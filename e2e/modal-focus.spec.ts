import { test, expect, type Locator, type Page } from '@playwright/test';
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
 * ones that only make sense with a file focused first (view, edit, copy, move,
 * delete). The viewer and the editor get an extra check because they are the
 * two that read the file's bytes: a real drive's listing carries no content, so
 * they can be perfectly focused over an empty frame, and that is what the
 * scratch folder's text file is for.
 *
 * One case follows a window replacing another: the viewer's "edit" button
 * swaps it for the editor, and the shell's habit of restoring focus on unmount
 * has to lose that race to the incoming window rather than drop focus on the
 * list behind it.
 *
 * A second family covers the windows that are not on a function key: quit,
 * batch rename, checksum and the bookmarks open with a Ctrl combination or F10,
 * and the rest are reached from a header menu or a header button. For those the
 * control that gets focus back is the menu title or the button itself, not the
 * list, so the case names it instead of settling for "something outside the
 * dialog".
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

interface KeyWindow {
  label: string;
  key: string;
  /** The subject is the focused entry: without one, the window has nothing to act on. */
  file?: boolean;
  /** What only this window can show, checked once focus has already landed. */
  opened?: (dialog: Locator) => Promise<void>;
}

/** What `nota.txt` holds, written by the fixture above. */
const NOTE_TEXT = 'una nota';

/**
 * Windows that a person opens with a key. `file` marks the ones whose subject is
 * the focused entry: without something under the cursor, view, edit, copy, move
 * and delete have nothing to act on.
 */
const KEY_WINDOWS: KeyWindow[] = [
  { label: 'help', key: 'F1' },
  { label: 'user menu', key: 'F2' },
  { label: 'new folder', key: 'F7' },
  { label: 'search and grep', key: 'Alt+F7' },
  {
    label: 'viewer',
    key: 'F3',
    file: true,
    // The text on screen has to be the one on disk. The viewer used to paint
    // `file.content`, a field the listing of a real drive never fills, so every
    // other check here would have passed over an empty frame.
    opened: async (dialog) => {
      await expect(dialog.getByText(NOTE_TEXT)).toBeVisible();
    },
  },
  {
    label: 'editor',
    key: 'F4',
    file: true,
    // Same reason, for the buffer: saving one that never loaded is what
    // truncated files, and the buffer is the window's whole purpose.
    opened: async (dialog) => {
      await expect(dialog.getByRole('textbox')).toHaveValue(`${NOTE_TEXT}\n`);
    },
  },
  { label: 'copy', key: 'F5', file: true },
  { label: 'move', key: 'F6', file: true },
  { label: 'delete', key: 'F8', file: true },
];

/**
 * One dialog, and focus on a named control inside it.
 *
 * Effects run after the commit that renders the window, and the copy/move window
 * moves focus to its destination field one tick later, so this polls instead of
 * reading focus at whatever moment the key press returned.
 */
async function expectWindowTakesFocus(page: Page, label: string, dialog: Locator) {
  // One dialog, not two: the shell owns it and the body no longer claims one.
  await expect(dialog, `the ${label} window is not the only dialog on screen`).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(dialog).toBeVisible();

  await expect
    .poll(async () => (await focusInfo(page)).insideDialog, {
      message: `the ${label} window never took focus`,
    })
    .toBe(true);

  const landed = await focusInfo(page);
  expect(landed, `the ${label} window opened with focus on <${landed.tag}> "${landed.text}"`).toMatchObject({
    insideDialog: true,
    named: true,
  });
  // A focused container would technically be "inside" while telling a screen
  // reader nothing, so the landing spot has to be a real control.
  expect(['button', 'input', 'select', 'textarea', 'a']).toContain(landed.tag);
}

/** Tab is trapped by the shell's own panel, which still wraps the body. */
async function expectWindowKeepsFocus(page: Page, label: string) {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const afterTab = await focusInfo(page);
  expect(afterTab, `two Tab presses left the ${label} window, on <${afterTab.tag}> "${afterTab.text}"`).toMatchObject({
    insideDialog: true,
  });
}

/**
 * Escape closes it and the keyboard lands back on something real — the control
 * that opened it — instead of on the body, where the next keystroke goes nowhere.
 */
async function expectWindowGivesFocusBack(page: Page, label: string, dialog: Locator, opener: Locator) {
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const restored = await focusInfo(page);
  expect(restored, `closing the ${label} window left focus on <${restored.tag}> "${restored.text}"`).toMatchObject({
    insideDialog: false,
  });
  expect(restored.tag, `closing the ${label} window left focus on the body`).not.toBe('body');
  await expect(
    opener,
    `closing the ${label} window has to hand focus back to the control that opened it`,
  ).toBeFocused();
}

for (const win of KEY_WINDOWS) {
  test(`focus enters the ${win.label} window and stays inside it`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-name]').first()).toBeVisible();
    if (win.file) await focusFile(page);

    // Where a keyboard user is when they press the key, and where the window has
    // to put them back: the list is the only focusable thing behind these.
    const list = page.locator('[data-file-list]').first();
    await list.focus();
    await expect(list).toBeFocused();

    await page.keyboard.press(win.key);

    const dialog = page.getByRole('dialog');
    await expectWindowTakesFocus(page, win.label, dialog);

    if (win.opened) await win.opened(dialog);

    await expectWindowKeepsFocus(page, win.label);
    await expectWindowGivesFocusBack(page, win.label, dialog, list);
  });
}

interface MoreWindow {
  label: string;
  /** A key pressed with the list focused. */
  key?: string;
  /** The header menu title and the command inside it, which the title opens. */
  menu?: { title: string; item: RegExp };
  /** A header button that opens the window on its own, found by its title. */
  button?: string;
  /** The subject is the focused entry: without one, there is nothing to show. */
  file?: boolean;
}

/**
 * The windows the first family does not reach.
 *
 * The command labels carry their shortcut in a second span, so they are matched
 * by their leading text rather than exactly — the accessible name is the whole
 * row, "Propiedades Alt+Enter" included.
 */
const MORE_WINDOWS: MoreWindow[] = [
  { label: 'quit', key: 'F10' },
  { label: 'batch rename', key: 'Control+M' },
  { label: 'checksum', key: 'Control+H', file: true },
  { label: 'bookmarks', key: 'Control+D' },
  { label: 'properties', file: true, menu: { title: 'Archivos', item: /^Propiedades/ } },
  { label: 'about', menu: { title: 'Ayuda', item: /^Acerca de OmniCommander/ } },
  { label: 'protect folder', menu: { title: 'Ayuda', item: /^Proteger Carpeta/ } },
  { label: 'command library', button: 'Biblioteca de Comandos CMD & Microsoft Winget' },
  { label: 'file splitter', file: true, menu: { title: 'Comandos', item: /^Dividir \/ Unir Archivo/ } },
  { label: 'background tasks', menu: { title: 'Comandos', item: /^Cola de Tareas/ } },
];

for (const win of MORE_WINDOWS) {
  test(`focus leaves and returns through the ${win.label} window`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-name]').first()).toBeVisible();
    if (win.file) await focusFile(page);

    let opener: Locator;
    if (win.key) {
      const list = page.locator('[data-file-list]').first();
      await list.focus();
      await expect(list).toBeFocused();
      await page.keyboard.press(win.key);
      opener = list;
    } else if (win.menu) {
      // The menu title is what has focus when the command is clicked, and the
      // command itself is gone by the time the window closes.
      opener = page.getByRole('button', { name: win.menu.title, exact: true }).first();
      await opener.click();
      // Scoped to the dropdown under that title: the same label also names a
      // command inside a window elsewhere on the page.
      await opener.locator('..').getByRole('button', { name: win.menu.item }).click();
    } else {
      opener = page.getByTitle(win.button ?? '');
      await opener.click();
    }

    const dialog = page.getByRole('dialog');
    await expectWindowTakesFocus(page, win.label, dialog);
    await expectWindowKeepsFocus(page, win.label);
    await expectWindowGivesFocusBack(page, win.label, dialog, opener);
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

test('editing from the viewer hands focus to the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible();
  await focusFile(page);

  await page.keyboard.press('F3');
  const viewer = page.getByRole('dialog', { name: 'Visor de archivos' });
  await expect(viewer).toBeVisible({ timeout: 30000 });

  await viewer.getByRole('button', { name: 'Editar (F4)' }).click();

  // The viewer unmounts and the editor mounts in the same commit, and the
  // viewer's shell puts focus back on whatever opened it as it goes. That
  // restore must not win: focus belongs in the window that is now on screen.
  const editor = page.getByRole('dialog', { name: 'Editor de texto' });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(viewer).toHaveCount(0);

  await expect
    .poll(async () => (await focusInfo(page)).insideDialog, {
      message: 'the editor never took focus after replacing the viewer',
    })
    .toBe(true);

  const landed = await focusInfo(page);
  expect(landed, `the editor opened with focus on <${landed.tag}> "${landed.text}"`).toMatchObject({
    insideDialog: true,
    named: true,
  });

  // The trap in force is the editor's own, not the one the viewer left behind.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await focusInfo(page)).toMatchObject({ insideDialog: true });

  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);

  // Closing the editor has to land back on something real. The button that
  // opened the viewer is gone by then, so a restore aimed at it does nothing and
  // focus falls to the document body, where the next keystroke goes nowhere.
  const back = await focusInfo(page);
  expect(back, `closing the editor left focus on <${back.tag}> "${back.text}"`).toMatchObject({
    insideDialog: false,
  });
  expect(back.tag, `closing the editor left focus on <${back.tag}> "${back.text}"`).not.toBe('body');

  // Specifically, back on the list the file came from: it is focusable and owns
  // the arrows, so the user resumes where they were instead of starting over.
  await expect(page.locator('[data-file-list]').first()).toBeFocused();
});

test('a window opened before anything was focused still gives focus back', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible();

  // Nothing has been clicked, so no control has been recorded as the opener:
  // this is the case the history alone cannot answer. Tab switches the active
  // panel on its own and leaves focus where it was, which makes the second
  // panel the one the fallback has to aim at.
  expect((await focusInfo(page)).tag, 'the page has to start with nothing focused').toBe('body');
  await page.keyboard.press('Tab');

  await page.keyboard.press('F10');
  const dialog = page.getByRole('dialog');
  await expectWindowTakesFocus(page, 'quit', dialog);

  const activeList = page.locator('[data-file-list][data-file-list-active="true"]');
  await expect(activeList).toHaveAttribute('aria-label', /panel derecho/);

  // With no opener left to return to, closing must not drop the keyboard on the
  // body: it lands on the list of the panel that was active.
  await expectWindowGivesFocusBack(page, 'quit', dialog, activeList);
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

  // Closing it has to land back on the list as well, not just close.
  const restored = await focusInfo(page);
  expect(restored, `closing the copy window left focus on <${restored.tag}> "${restored.text}"`).toMatchObject({
    insideDialog: false,
  });
  await expect(page.locator('[data-file-list]').first()).toBeFocused();
});
