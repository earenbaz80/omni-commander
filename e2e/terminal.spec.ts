import { test, expect, type Page } from '@playwright/test';
import { seedSettings } from './support/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeWorkspace } from './support/tempWorkspaces';

/**
 * The shell as a window of its own, opened with the console key.
 *
 * It is not a second interpreter: the window hands every line to the same
 * `handleExecuteCommand` the command bar uses, and paints the same log. That is
 * the promise worth walking through the interface, because the ways it can break
 * are the ways a second interpreter breaks: a line that only appears in the
 * window, a `cd` that changes the prompt and leaves the panel behind, a history
 * that recalls something the shell never ran.
 *
 * So each case below presses through the real window: the arrow keys have to
 * reproduce the commands in the order they were run without sending any of them,
 * and `cd` has to move the panel under the window -- which is the half a unit
 * test of the modal cannot see, since the panel is not its child.
 *
 * `del` is the one line here that destroys something, and it does so without the
 * confirmation dialog the file list goes through: the shell calls the engine
 * directly. Its case therefore deletes a file this spec created inside its own
 * temporary workspace, and asks the folder afterwards rather than trusting the
 * panel's own listing.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

let workspace = '';
let alfa = '';

test.beforeEach(async ({ page }) => {
  // Pin the UI language: the labels read below are Spanish.
  await seedSettings(page, { language: 'es' });

  // A folder with one level under it, so `cd beta` and `cd ..` both land
  // somewhere that really exists and the panel has something to list.
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-term-'));
  alfa = path.join(workspace, 'alfa');
  await fs.mkdir(path.join(alfa, 'beta'), { recursive: true });
  await fs.writeFile(path.join(alfa, 'nota.txt'), 'hola\n', 'utf8');
  // Written here rather than in the test that deletes it: a file created moments
  // before the server removes it can still be held by the platform's scanner,
  // and a locked file turns into a failed job the shell never reports.
  await fs.writeFile(path.join(alfa, 'borrar.txt'), 'se va\n', 'utf8');
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

/**
 * Types an absolute path into one panel's path bar and waits until the bar shows
 * it. A panel can still be settling the path it opened with right after load,
 * which would overwrite the first try, so the user action is repeated instead
 * of only waiting: the last attempt still has to pass a real assertion.
 */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  const bar = page.locator('[data-path-bar]').nth(panel);
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
      // Try the same thing again; the final failure reports the real state.
    }
  }

  await expect(bar).toContainText(folder);
}

/** The left panel's path bar, which is the one `cd` is expected to move. */
const leftBar = (page: Page) => page.locator('[data-path-bar]').nth(0);

/**
 * Opens the window the way it is meant to be opened: the left panel is made
 * active first (the shortcut bails out while a field has the focus), then
 * Ctrl+` is pressed.
 */
async function openTerminal(page: Page) {
  await page.locator('[data-file-list]').nth(0).click();
  await page.keyboard.press('Control+Backquote');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText('Terminal de OmniCommander');
  return dialog;
}

/** The prompt of the window, which is the last line of its scrollback. */
const prompt = (page: Page) => page.getByRole('dialog').getByRole('textbox');

/** Sends one line through the real prompt. */
async function run(page: Page, line: string) {
  const input = prompt(page);
  await input.click();
  await input.fill(line);
  await input.press('Enter');
}

test('the console key opens the shell and prints what it ran', async ({ page }) => {
  await page.goto('/');
  const dialog = await openTerminal(page);

  // Before anything runs it explains itself rather than showing an empty screen.
  await expect(dialog).toContainText("Escriba 'help' para ver los comandos.");

  await run(page, 'echo hola');

  const log = page.locator('[data-terminal-log]');
  // The line and its answer, both in the scrollback: a terminal that echoes
  // nothing makes the user wonder whether the shell heard them.
  await expect(log).toContainText('echo hola');
  await expect(log.getByText('hola', { exact: true })).toBeVisible();
  await expect(log).not.toContainText("Escriba 'help' para ver los comandos.");

  // The prompt is emptied so the next line starts clean, and the caret stays in
  // the window instead of moving to a field somewhere else.
  await expect(prompt(page)).toHaveValue('');
  await expect(prompt(page)).toBeFocused();
});

test('the arrow keys walk the history without running anything', async ({ page }) => {
  await page.goto('/');
  await openTerminal(page);

  await run(page, 'help');
  await run(page, 'echo dos');

  const log = page.locator('[data-terminal-log]');
  const entries = log.locator('div > div.mb-\\[var\\(--space-1\\)\\]');
  await expect(entries).toHaveCount(2);

  const input = prompt(page);
  await input.click();
  await input.fill('zzz');

  // From the newest command backwards, then forwards again to the fresh line:
  // this is the history the command bar also keeps, not a guess.
  await input.press('ArrowUp');
  await expect(input).toHaveValue('echo dos');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('help');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('echo dos');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('');

  // Walking the history is not running it: the log has not moved.
  await expect(entries).toHaveCount(2);

  // A recalled line is still a line: Enter sends it, and the log grows.
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(entries).toHaveCount(3);
});

test('cd moves the panel the user is working in, not just the prompt', async ({ page }) => {
  await page.goto('/');
  await enterPath(page, 0, alfa);
  await expect(leftBar(page)).toContainText('alfa');

  await openTerminal(page);
  const log = page.locator('[data-terminal-log]');
  const bar = leftBar(page);

  await run(page, 'cd beta');

  // The answer says where it went, the prompt follows it, and the panel behind
  // the window lists that folder -- the one promise a modal cannot keep alone.
  await expect(log).toContainText('Cambiado a');
  await expect(log).toContainText('beta>');
  await expect(bar).toContainText('beta');

  await run(page, 'cd ..');

  // `cd ..` is the parent, resolved by the app rather than typed as a literal
  // folder called "..", and the panel comes back with it.
  await expect(log).toContainText('Cambiado a directorio superior');
  await expect(bar).not.toContainText('beta');
  await expect(log).toContainText('alfa>');

  // The move belongs to the panel: closing the window leaves the user where the
  // shell took them instead of undoing the navigation with the dialog.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(bar).not.toContainText('beta');
  await expect(page.locator('[data-name="beta"]')).toBeVisible();
});

test('del removes the file it names and refuses a name that is not listed', async ({ page }) => {
  // Every delete the app asks the server for, so the case can say that a name it
  // refused never became one.
  const deletes: { targets: string[]; useTrash: boolean }[] = [];
  const forName = (name: string) => deletes.filter((entry) => entry.targets.some((target) => target.includes(name)));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/fs/delete')) {
      deletes.push(request.postDataJSON() as { targets: string[]; useTrash: boolean });
    }
  });

  await page.goto('/');
  await enterPath(page, 0, alfa);
  await expect(page.locator('[data-name="borrar.txt"]')).toBeVisible();

  await openTerminal(page);
  const log = page.locator('[data-terminal-log]');

  await run(page, 'del borrar.txt');

  // The file it named, and only that one: the neighbour stays where it was.
  await expect(log).toContainText('Archivo borrar.txt eliminado');
  await expect(page.locator('[data-name="borrar.txt"]')).toHaveCount(0);
  await expect(page.locator('[data-name="nota.txt"]')).toBeVisible();

  // No confirmation, and that is the point of the case: the list's delete asks
  // first (`delete-dialog.spec.ts`), this line does not, so the terminal is the
  // only window on screen afterwards.
  await expect(page.getByRole('dialog')).toHaveCount(1);

  // A name the panel is not listing is refused, reported with what was typed,
  // and asks the server for nothing.
  await run(page, 'del fantasma.txt');
  await expect(log).toContainText('No se encontró el archivo fantasma.txt');
  await expect(page.locator('[data-name="nota.txt"]')).toBeVisible();
  expect(forName('fantasma.txt'), 'a name the panel never listed must not reach the server').toHaveLength(0);
  expect(await fs.readdir(alfa)).toContain('nota.txt');
});
