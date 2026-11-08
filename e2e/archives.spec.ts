import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import { removeWorkspace } from './support/tempWorkspaces';
import path from 'node:path';

/**
 * Opening several archive formats and extracting them, driven through the
 * interface rather than through the engine.
 *
 * RAR and 7-Zip are the interesting case because no part of the renderer can
 * read them: the panel asks the local server, which runs libarchive's WASM. A
 * test that only called the engine would prove the bridge works but not that a
 * click reaches it, so each of these starts at the file list and ends at bytes
 * on disk.
 *
 * A ZIP is here for the opposite reason: the renderer reads that one itself, so
 * it covers the path the other two never touch. Same test, so a regression in
 * either backend shows up in the same place.
 *
 * The fixtures are the committed ones (test-fixtures/archives/sample.rar,
 * sample.7z, sample.zip and sample-encrypted.rar), built by
 * scripts/make-archive-fixtures.mjs and validated there against bsdtar.
 */

/**
 * The panels address storage by drive letter: a drive button reads `[C:]`, the
 * engine names drives `real_C`, and the server resolves paths as `C:\...` or a
 * bare letter. Wherever a path starts with `/` instead there is no drive to
 * click, so this spec has nothing to drive there -- it is skipped, not failed,
 * because nothing is broken on those platforms; the interface is drive-based.
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

let workspace = '';

test.beforeEach(async () => {
  // A scratch folder on the real disk: the app is a file manager, so the archive
  // has to be somewhere the local server can actually open.
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-archive-'));
  await fs.mkdir(path.join(workspace, 'destino'));
  for (const name of ['sample.rar', 'sample.7z', 'sample.zip', 'sample-encrypted.rar']) {
    await fs.copyFile(path.resolve('test-fixtures/archives', name), path.join(workspace, name));
  }
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

/** Types an absolute path into one panel's path bar and submits it. */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  // The bar's title is translated and this suite pins Spanish, so the locator
  // uses the stable hook instead of an English label that no longer exists.
  await page.locator('[data-path-bar]').nth(panel).click();
  // Only the path bar being edited renders this field, so there is exactly one.
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(target);
  await input.press('Enter');
}

interface ArchiveCase {
  label: string;
  file: string;
  /** The archive's own top-level folder, when it keeps its payload inside one. */
  folder: string | null;
  /** What lands in the destination when the archive's payload is copied there. */
  entries: string[];
  /** Set when the archive must ask for a password before it can be listed. */
  password?: string;
}

/**
 * One case per format. `folder` is the archive's own top-level folder when it
 * has one: the 7-Zip fixture nests everything under `fixture/`, so the test has
 * to step into it before there is anything to select. The encrypted RAR has its
 * names encrypted too, which is why it cannot even be listed without the key.
 */
const archives: ArchiveCase[] = [
  { label: 'a RAR', file: 'sample.rar', folder: null, entries: ['a.txt', 'sub'] },
  { label: 'a ZIP', file: 'sample.zip', folder: null, entries: ['a.txt', 'sub'] },
  // The 7-Zip also carries an empty `vacio.txt`, which must land like any other.
  { label: 'a 7-Zip', file: 'sample.7z', folder: 'fixture', entries: ['a.txt', 'sub', 'vacio.txt'] },
  {
    label: 'an encrypted RAR',
    file: 'sample-encrypted.rar',
    folder: null,
    entries: ['a.txt', 'sub'],
    password: 'omnicmd',
  },
];

for (const archive of archives) {
  test(`opens ${archive.label} from the panel and extracts it into the other panel`, async ({ page }) => {
    test.setTimeout(240000);
    await page.goto('/');

    // Both panels must be on the drive that holds the scratch folder: the server
    // refuses a listing that points outside the panel's own drive.
    const drive = path.parse(workspace).root.replace(/[\\/]/g, '');
    const driveButtons = page.getByRole('button', { name: `[${drive}]` });
    await expect(driveButtons.first()).toBeVisible({ timeout: 90000 });
    await driveButtons.nth(0).click();
    await driveButtons.nth(1).click();

    await enterPath(page, 0, workspace);
    const archiveRow = page.locator(`[data-name="${archive.file}"]`);
    await expect(archiveRow).toBeVisible({ timeout: 30000 });

    await enterPath(page, 1, path.join(workspace, 'destino'));
    await expect(page.locator('[data-path-bar]').nth(1)).toContainText('destino');

    // Double-click is how the app opens a file: for an archive it lists the
    // contents in place, and only the local server can have read them.
    await archiveRow.dblclick();

    if (archive.password) {
      const prompt = page.locator('input[type="password"]');
      await expect(prompt).toBeVisible({ timeout: 30000 });
      // The modal speaks the app's language, not English with a translated frame.
      await expect(page.getByText(/Escribe la contraseña de/)).toBeVisible();

      // A wrong password comes back to the same prompt marked invalid, instead
      // of mounting a folder whose bytes could never be read.
      await prompt.fill('equivocada');
      await page.getByRole('button', { name: 'Aceptar (Enter)' }).click();
      await expect(page.getByText(/Contraseña incorrecta/)).toBeVisible({ timeout: 30000 });

      await page.locator('input[type="password"]').fill(archive.password);
      await page.getByRole('button', { name: 'Aceptar (Enter)' }).click();
    }

    if (archive.folder) {
      const folder = page.locator(`[data-name="${archive.folder}"]`);
      await expect(folder).toBeVisible({ timeout: 60000 });
      await folder.dblclick();
    }
    // Scoped to the first match, the left panel, in case the destination already
    // holds a file with the same name.
    await expect(page.locator('[data-name="a.txt"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-name="sub"]').first()).toBeVisible();

    // F5 is the copy shortcut; for an entry that lives inside an archive, copying
    // it to the other panel is extracting it.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('F5');
    const copyButton = page.getByRole('button', { name: 'Copiar (Enter)' });
    await expect(copyButton).toBeVisible({ timeout: 30000 });
    await copyButton.click();

    const destination = path.join(workspace, 'destino');
    await expect
      .poll(
        async () => {
          const entries = await fs.readdir(destination, { withFileTypes: true }).catch(() => []);
          return entries.map((entry) => entry.name).sort();
        },
        { timeout: 60000, message: 'the extraction never wrote the entries into the destination' },
      )
      .toEqual(archive.entries);

    // The bytes come from libarchive, not from anything this repository wrote.
    expect(await fs.readFile(path.join(destination, 'a.txt'), 'utf8')).toBe('hola archivo\n');
    expect(await fs.readFile(path.join(destination, 'sub', 'b.txt'), 'utf8')).toBe('anidado en la carpeta\n');
  });
}
