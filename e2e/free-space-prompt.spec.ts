import { test, expect, type Page } from '@playwright/test';
import { seedSettings } from './support/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT_TIMEOUT_MS } from './support/boot';
import { removeWorkspace } from './support/tempWorkspaces';

/**
 * The window that stands between a copy and a disk that cannot hold it.
 *
 * The unit test renders the dialog with made-up volumes; it cannot show that a
 * real transfer stops to ask, or that the button which overrides the warning
 * actually starts the copy instead of closing a dialog. Here the server's
 * pre-flight answer is stubbed, because a machine in CI cannot be made to run out
 * of space on purpose, and everything else is the app doing the work: the keys,
 * the transfer window, the prompt and the files on disk afterwards.
 *
 * Cancelling must leave the destination untouched, and forcing must not ask a
 * second time: the numbers were already read and accepted.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

test.beforeEach(async ({ page }) => {
  await seedSettings(page, { language: 'es' });
});

const CONTENT = 'llena el disco\n';
/** Four kilobytes for a folder that reports one free: three short. */
const REPORT = { size: 4096, free: 1024, lacking: 3072 };

let sourceDir = '';
let targetDir = '';

test.beforeEach(async () => {
  sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-space-src-'));
  targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-space-dst-'));
  await fs.writeFile(path.join(sourceDir, 'pesado.bin'), CONTENT, 'utf8');
});

test.afterEach(async () => {
  for (const dir of [sourceDir, targetDir]) {
    if (dir) await removeWorkspace(dir);
  }
});

/**
 * Answers the pre-flight with a volume that cannot hold the copy, and records
 * every time it was asked. The bodies are kept so a case can prove the check ran
 * once, or not at all.
 */
async function stubFreeSpace(page: Page) {
  const calls: unknown[] = [];
  await page.route('**/api/fs/freespace', async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        volumes: [{ volume: driveRoot, ...REPORT, complete: true }],
      }),
    });
  });
  return calls;
}

/** Reads a file, treating "not there yet" as no value so `poll` can retry. */
async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

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
  await enterPath(page, 0, sourceDir);
  await enterPath(page, 1, targetDir);
  await expect(page.locator('[data-name="pesado.bin"]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
}

/** Opens the copy window for the selected row and starts the transfer. */
async function startCopy(page: Page) {
  await page.locator('[data-name="pesado.bin"]').first().click();
  await page.keyboard.press('F5');

  const window = page.getByRole('dialog', { name: 'Copiar Archivos' });
  await expect(window).toBeVisible({ timeout: 30000 });
  await expect(window.locator('input[type="text"]')).toHaveValue(targetDir);
  await window.getByRole('button', { name: 'Copiar (Enter)' }).click();

  const prompt = page.getByRole('dialog', { name: 'Espacio libre insuficiente' });
  await expect(prompt).toHaveCount(1, { timeout: 60000 });
  await expect(prompt).toBeVisible();
  return prompt;
}

test('shows what the copy needs, has and misses, and cancelling copies nothing', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await stubFreeSpace(page);
  await openPanels(page);

  const prompt = await startCopy(page);

  // Both sides of the shortfall, in the units the rest of the app prints: the
  // size the sources will write, the room the volume has, and the difference.
  await expect(prompt.getByText(driveRoot, { exact: true })).toBeVisible();
  await expect(prompt.getByRole('cell', { name: '4.0 KB', exact: true })).toBeVisible();
  await expect(prompt.getByRole('cell', { name: '1.0 KB', exact: true })).toBeVisible();
  await expect(prompt.getByRole('cell', { name: '3.0 KB', exact: true })).toBeVisible();

  // The warning is a question, not a report of something already done.
  expect(calls).toHaveLength(1);
  expect(await fs.readdir(targetDir)).toEqual([]);

  // Two controls carry that name: the ✕ in the header and the button below. The
  // footer one is what a person reads as the answer to the question.
  await prompt.getByRole('button', { name: 'Cancelar', exact: true }).last().click();
  await expect(prompt).toHaveCount(0);

  // Nothing was written, before or after the answer.
  expect(await fs.readdir(targetDir)).toEqual([]);
  expect(await fs.readFile(path.join(sourceDir, 'pesado.bin'), 'utf8')).toBe(CONTENT);
});

test('forcing starts the copy without asking about the space again', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await stubFreeSpace(page);
  await openPanels(page);

  const prompt = await startCopy(page);
  await prompt.getByRole('button', { name: 'Forzar copia', exact: true }).click();
  await expect(prompt).toHaveCount(0);

  // The copy went ahead on the strength of the click alone.
  await expect.poll(() => readIfPresent(path.join(targetDir, 'pesado.bin'))).toBe(CONTENT);
  // And it did not ask the server to re-measure: the numbers were accepted.
  expect(calls).toHaveLength(1);
});
