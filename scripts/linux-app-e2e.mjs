/**
 * Three things a person does in the packaged Linux app, done through the window.
 *
 * The smoke next door answers one question: does the packaged app boot and list
 * a mount? That is the floor. A window that lists a drive can still be unable to
 * enter a folder, to copy between its two panels or to delete a file, because
 * those go through the keyboard engine, the transfer queue and the server's file
 * operations -- code the listing never touches. So each case below starts from
 * the file list, presses the keys a user presses, and then reads the scratch
 * folders and the XDG trash back on disk, which is the only way to tell an
 * operation from a dialog that looks right.
 *
 * The delete case turns the Recycle Bin off on purpose. With it on, the file
 * leaves the folder just the same and only the trash proves where it went, so a
 * check that looks at the folder alone would pass for the wrong reason.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendSummary, attachToWindow, escapeCommandData, startPackagedApp, waitFor } from './linux-app-harness.mjs';

const appImage = process.argv[2];
if (!appImage) {
  console.error('usage: node scripts/linux-app-e2e.mjs <path to the AppImage>');
  process.exit(2);
}

const port = Number(process.env.LINUX_APP_CDP_PORT ?? 9334);

/** The bytes the copy has to carry, so a truncated write fails the case. */
const NOTE = 'nota de origen\n';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-linux-'));
const origen = path.join(workspace, 'origen');
const destino = path.join(workspace, 'destino');
const dentro = path.join(origen, 'abrir');

await fs.mkdir(dentro, { recursive: true });
await fs.mkdir(destino, { recursive: true });
await fs.writeFile(path.join(dentro, 'dentro.txt'), 'dentro\n', 'utf8');
await fs.writeFile(path.join(origen, 'nota.txt'), NOTE, 'utf8');
await fs.writeFile(path.join(origen, 'borrar.txt'), 'borrame\n', 'utf8');
// A row of its own, so the right panel can be activated by clicking something
// that exists only on its side.
await fs.writeFile(path.join(destino, 'marcador.txt'), 'marca\n', 'utf8');

/**
 * Where the XDG trash keeps what it takes.
 *
 * The app deletes through the server, and on Linux the server's trash is the
 * freedesktop one. Naming the file here is what separates "removed" from "moved
 * somewhere the folder no longer shows".
 */
const trashDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Trash');

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** The file's text, or null when it is not there, so `waitFor` can retry. */
async function readIfPresent(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Whether the trash holds that name in its files or in its metadata. */
async function trashed(name) {
  for (const sub of ['files', 'info']) {
    let entries = [];
    try {
      entries = await fs.readdir(path.join(trashDir, sub));
    } catch {
      continue;
    }
    if (entries.includes(name) || entries.includes(`${name}.trashinfo`)) return true;
  }
  return false;
}

const row = (page, name) => page.locator(`[data-name="${name}"]`).first();

/**
 * Types an absolute path into one panel's path bar and submits it.
 *
 * Nothing in the window is addressed by a drive letter here: the panels start on
 * `/` and every folder below it is reached by the same path a shell would use,
 * which is what the Linux port has to make true.
 */
async function enterPath(page, panel, target) {
  const bar = page.locator('[data-path-bar]').nth(panel);
  // The middle of the bar is not empty space: on a short path the crumbs sit
  // there, and a crumb's own click navigates to that level instead of opening
  // the editor. The corner is the bar itself, whatever its crumbs hold.
  await bar.click({ position: { x: 4, y: 2 } });
  const input = page.locator('[data-path-input]');
  try {
    await input.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    const shown = (await bar.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    throw new Error(`the path bar showing "${shown}" did not open its editor`);
  }
  await input.fill(target);
  await input.press('Enter');
  await waitFor(async () => (await page.locator('[data-path-input]').count()) === 0, {
    label: `the ${panel === 0 ? 'left' : 'right'} panel to accept ${target}`,
  });
}

/** Points both panels at the scratch folders and waits for their rows. */
async function openPanels(page) {
  await enterPath(page, 0, origen);
  await enterPath(page, 1, destino);
  await row(page, 'nota.txt').waitFor({ state: 'visible', timeout: 30_000 });
  await row(page, 'marcador.txt').waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Turns the Recycle Bin off before the window boots.
 *
 * The app reads its settings from localStorage under the key `SETTINGS_KEY` in
 * `src/services/storage.ts`, and a bare object is read as the oldest stored
 * shape, so this needs no version of its own. Written before the reload, the
 * policy is in place when the first render reads it.
 */
async function seedSettings(page) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: 'nc_settings_v1', value: JSON.stringify({ useRecycleBin: false }) },
  );
  await page.reload();
  await page.locator('[data-name]').first().waitFor({ state: 'visible', timeout: 90_000 });
}

const cases = [
  {
    name: 'opens a folder from the list',
    async run(page) {
      await openPanels(page);

      // Double-click is how the list opens a row; the panel has to leave the
      // folder it was in, not paint the child's name over the parent's rows.
      await row(page, 'abrir').dblclick();
      await row(page, 'dentro.txt').waitFor({ state: 'visible', timeout: 30_000 });

      if ((await page.locator('[data-name="nota.txt"]').count()) !== 0) {
        throw new Error('the panel still shows the folder it was in after opening a child');
      }
      // The crumbs are the panel's own statement of where it now is.
      await waitFor(async () => (await page.locator('[data-path-bar]').nth(0).innerText()).includes('abrir'), {
        label: 'the path bar to show the folder that was opened',
      });
    },
  },
  {
    name: 'copies a file into the other panel',
    async run(page) {
      await openPanels(page);

      await row(page, 'nota.txt').click();
      await page.keyboard.press('Control+c');

      // Clicking a row in the right panel makes it the active one, which is what
      // decides where the paste lands.
      await row(page, 'marcador.txt').click();
      await page.keyboard.press('Control+v');

      await waitFor(async () => (await readIfPresent(path.join(destino, 'nota.txt'))) === NOTE, {
        label: 'the copy to reach the destination folder with the source bytes',
      });
      if ((await readIfPresent(path.join(origen, 'nota.txt'))) !== NOTE) {
        throw new Error('a copy must leave the original where it was');
      }
    },
  },
  {
    name: 'deletes a file without sending it to the trash',
    async run(page) {
      await openPanels(page);
      if (await trashed('borrar.txt')) throw new Error('the trash already holds that name before the case runs');

      await row(page, 'borrar.txt').click();
      await page.keyboard.press('F8');

      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 20_000 });
      // The window labels its confirm button with the key that presses it, in
      // every language, which is why this does not depend on the UI language.
      await dialog.getByRole('button', { name: /\(Enter\)/ }).click();

      await waitFor(async () => !(await exists(path.join(origen, 'borrar.txt'))), {
        label: 'the file to leave the folder',
      });
      if (!(await exists(path.join(origen, 'nota.txt')))) {
        throw new Error('the delete took a file that was not the one focused');
      }
      // The bin is off, so a file that turned up here would mean the setting
      // never reached the app and the case proved something else.
      if (await trashed('borrar.txt')) {
        throw new Error('the Recycle Bin is off but the file was moved to the XDG trash');
      }
    },
  },
];

const results = [];
const app = startPackagedApp(appImage, port);
let browser;

/** Puts the verdicts on the run page, where a reader of the log cannot be lost. */
function report() {
  const failed = results.filter((result) => !result.ok);
  appendSummary(
    [
      `### Linux AppImage e2e: ${results.length - failed.length} of ${results.length} cases passed`,
      '',
      '| case | result |',
      '| --- | --- |',
      ...results.map((result) => `| ${result.name} | ${result.ok ? 'passed' : '**failed**'} |`),
      ...failed.map((result) => `\n**${result.name}**: ${result.reason}`),
    ].join('\n'),
  );

  if (failed.length === 0) {
    for (const result of results) console.log(`ok ${result.name}`);
    return;
  }

  const lastLines = app.tail() || '(the app printed nothing)';
  for (const result of failed) {
    const message = `linux e2e: ${result.name}: ${result.reason}`;
    console.error(message);
    console.error(`::error::${escapeCommandData(`${message}\n--- last lines of the app ---\n${lastLines}`)}`);
  }
  appendSummary(
    ['', '<details><summary>App log, last 40 lines</summary>', '', '````', lastLines, '````', '', '</details>'].join(
      '\n',
    ),
  );
}

try {
  const attached = await attachToWindow(app, port);
  browser = attached.browser;
  await seedSettings(attached.page);

  for (const testCase of cases) {
    try {
      await testCase.run(attached.page);
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      // One case failing must not hide the others: the point of running three is
      // knowing which of them the port can already do.
      results.push({ name: testCase.name, ok: false, reason: String(error?.message ?? error) });
    }
  }
} catch (error) {
  // Nothing was assigned the blame yet: the harness itself is what broke.
  results.push({ name: 'launch and attach', ok: false, reason: String(error?.message ?? error) });
} finally {
  app.stop();
  if (browser) await browser.close().catch(() => {});
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
}

report();
process.exit(results.every((result) => result.ok) ? 0 : 1);
