/**
 * Four things a person does in the packaged Linux app, done through the window.
 *
 * The smoke next door answers one question: does the packaged app boot and list
 * a mount? That is the floor. A window that lists a drive can still be unable to
 * enter a folder, to copy between its two panels or to delete a file, because
 * those go through the keyboard engine, the transfer queue and the server's file
 * operations -- code the listing never touches. So each case below starts from
 * the file list, presses the keys a user presses, and then reads the scratch
 * folders and the freedesktop trash back on disk, which is the only way to tell
 * an operation from a dialog that looks right.
 *
 * Deleting gets two cases because the app has two branches behind one key. With
 * the Recycle Bin on, the file has to leave the folder and land in the trash
 * with metadata a restore can be built from; with it off, the file has to be
 * gone for good. A test that only checked the folder would pass for both and
 * tell them apart from nothing.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendSummary,
  attachToWindow,
  escapeCommandData,
  sleep,
  startPackagedApp,
  waitFor,
} from './linux-app-harness.mjs';

const appImage = process.argv[2];
if (!appImage) {
  console.error('usage: node scripts/linux-app-e2e.mjs <path to the AppImage>');
  process.exit(2);
}

const port = Number(process.env.LINUX_APP_CDP_PORT ?? 9334);

/** The bytes the copy has to carry, so a truncated write fails the case. */
const NOTE = 'nota de origen\n';
const RECYCLED = 'va a la papelera\n';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-linux-'));
const origen = path.join(workspace, 'origen');
const destino = path.join(workspace, 'destino');
const dentro = path.join(origen, 'abrir');

await fs.mkdir(dentro, { recursive: true });
await fs.mkdir(destino, { recursive: true });
await fs.writeFile(path.join(dentro, 'dentro.txt'), 'dentro\n', 'utf8');
await fs.writeFile(path.join(origen, 'nota.txt'), NOTE, 'utf8');
await fs.writeFile(path.join(origen, 'borrar.txt'), 'borrame\n', 'utf8');
await fs.writeFile(path.join(origen, 'reciclado.txt'), RECYCLED, 'utf8');
// A row of its own, so the right panel can be activated by clicking something
// that exists only on its side.
await fs.writeFile(path.join(destino, 'marcador.txt'), 'marca\n', 'utf8');

/**
 * Where the freedesktop trash keeps what it takes.
 *
 * The app's own fallback writes `$XDG_DATA_HOME/Trash`, but the preferred path
 * is `gio trash`, which uses the home trash only when the file is on the home
 * filesystem and otherwise a trash at the top of the mount. Both layouts hold
 * `files/<name>` and `info/<name>.trashinfo`, so the cases look in both places
 * instead of assuming which one this runner took.
 */
const homeTrash = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Trash');

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** The file's text, or null when it is not there, so a wait can retry. */
async function readIfPresent(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** The top of the filesystem `dir` lives on, where a mount-local trash would sit. */
async function mountTopOf(dir) {
  let current = await fs.realpath(dir);
  const { dev } = await fs.stat(current);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    if ((await fs.stat(parent)).dev !== dev) return current;
    current = parent;
  }
}

/** Every trash that could hold something deleted from `dir`, home first. */
async function trashRootsFor(dir) {
  const top = await mountTopOf(dir);
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '1000';
  const roots = [homeTrash, path.join(top, `.Trash-${uid}`), path.join(top, '.Trash', uid)];
  return [...new Set(roots)];
}

/** The entry for `name`, wherever this machine's trash put it, or null. */
async function findTrashEntry(name) {
  for (const root of await trashRootsFor(origen)) {
    const file = path.join(root, 'files', name);
    const info = path.join(root, 'info', `${name}.trashinfo`);
    if ((await exists(info)) && (await exists(file))) return { root, file, info };
  }
  return null;
}

/**
 * The original path and deletion date the entry records.
 *
 * `Path` is URL-encoded per segment, which is how the app writes it and what the
 * spec asks for; decoding segment by segment keeps the separators and survives a
 * name that carries a stray `%`.
 */
async function readTrashInfo(entry) {
  const text = await fs.readFile(entry.info, 'utf8');
  if (!text.startsWith('[Trash Info]')) {
    throw new Error(`the trash entry has no [Trash Info] header: ${text.slice(0, 80)}`);
  }
  const pathLine = /^Path=(.*)$/m.exec(text);
  const dateLine = /^DeletionDate=(.*)$/m.exec(text);
  if (!pathLine) throw new Error('the trash entry names no original path');
  if (!dateLine) throw new Error('the trash entry records no deletion date');

  const original = pathLine[1]
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
  return { original, deletionDate: dateLine[1] };
}

/** Puts an entry back where its metadata says it came from, as a desktop trash does. */
async function restoreTrashEntry(entry) {
  const { original } = await readTrashInfo(entry);
  if (!path.isAbsolute(original)) throw new Error(`the trash entry names no absolute path: ${original}`);
  await fs.mkdir(path.dirname(original), { recursive: true });
  try {
    await fs.rename(entry.file, original);
  } catch (error) {
    // The trash can sit on another filesystem than the file it took.
    if (error?.code !== 'EXDEV') throw error;
    await fs.copyFile(entry.file, original);
    await fs.rm(entry.file, { force: true });
  }
  await fs.rm(entry.info, { force: true });
  return original;
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

/**
 * How long a panel gets to paint its rows.
 *
 * A request to the app's own server is retried with a 10 s timeout and two
 * backoffs, and a boot chains two of them: a slow boot answers after 63 s, while
 * these waits used to give up at 30 s. On a runner whose egress is throttled,
 * the app's own update check is enough to push the first listing past that, and
 * the cases then reported "the panel never listed" for an app that was listing.
 */
const ROWS_TIMEOUT_MS = 90_000;

/** Points both panels at the scratch folders and waits for their rows. */
async function openPanels(page) {
  await enterPath(page, 0, origen);
  await enterPath(page, 1, destino);
  await row(page, 'nota.txt').waitFor({ state: 'visible', timeout: ROWS_TIMEOUT_MS });
  await row(page, 'marcador.txt').waitFor({ state: 'visible', timeout: ROWS_TIMEOUT_MS });
}

/**
 * Writes the settings the next case needs and restarts the window on them.
 *
 * The app reads its settings from localStorage under the key `SETTINGS_KEY` in
 * `src/services/storage.ts`, and a bare object is read as the oldest stored
 * shape, so this needs no version of its own. Registering the script before the
 * reload puts the value there for the first render; a later registration runs
 * after an earlier one, which is how a case overrides the one before it.
 */
async function setSettings(page, settings) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: 'nc_settings_v1', value: JSON.stringify(settings) },
  );
  await page.reload();
  await page.locator('[data-name]').first().waitFor({ state: 'visible', timeout: 90_000 });
}

/** Polls `produce` until it returns something truthy, and hands that back. */
async function waitForValue(produce, { timeoutMs = 30_000, intervalMs = 250, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await produce();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
    await sleep(intervalMs);
  }
}

/** Presses F8 on the focused row and confirms the window that opens. */
async function deleteFocusedRow(page) {
  await page.keyboard.press('F8');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  // The window labels its confirm button with the key that presses it, in every
  // language, which is why this does not depend on the UI language.
  await dialog.getByRole('button', { name: /\(Enter\)/ }).click();
}

const cases = [
  {
    name: 'opens a folder from the list',
    async run(page) {
      await openPanels(page);

      // Double-click is how the list opens a row; the panel has to leave the
      // folder it was in, not paint the child's name over the parent's rows.
      await row(page, 'abrir').dblclick();
      await row(page, 'dentro.txt').waitFor({ state: 'visible', timeout: ROWS_TIMEOUT_MS });

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
      await setSettings(page, { useRecycleBin: false });
      await openPanels(page);
      if (await findTrashEntry('borrar.txt')) {
        throw new Error('the trash already holds that name before the case runs');
      }

      await row(page, 'borrar.txt').click();
      await deleteFocusedRow(page);

      await waitFor(async () => !(await exists(path.join(origen, 'borrar.txt'))), {
        label: 'the file to leave the folder',
      });
      if (!(await exists(path.join(origen, 'nota.txt')))) {
        throw new Error('the delete took a file that was not the one focused');
      }
      // The bin is off, so a file that turned up in the trash would mean the
      // setting never reached the app and the case proved something else.
      if (await findTrashEntry('borrar.txt')) {
        throw new Error('the Recycle Bin is off but the file was moved to the trash');
      }
    },
  },
  {
    name: 'deletes a file into the trash and the entry restores it',
    async run(page) {
      await setSettings(page, { useRecycleBin: true });
      await openPanels(page);

      const original = path.join(origen, 'reciclado.txt');
      await row(page, 'reciclado.txt').click();
      await deleteFocusedRow(page);

      await waitFor(async () => (await readIfPresent(original)) === null, {
        label: 'the file to leave the folder',
      });

      // The entry, its payload and its metadata: a trash that only moved the
      // bytes would leave a desktop unable to say where they came from.
      const entry = await waitForValue(() => findTrashEntry('reciclado.txt'), {
        label: 'the file to appear in the trash with its .trashinfo',
      });
      if ((await readIfPresent(entry.file)) !== RECYCLED) {
        throw new Error('the trash holds the entry but not the bytes of the file');
      }
      const info = await readTrashInfo(entry);
      if (info.original !== original) {
        throw new Error(`the .trashinfo names ${info.original} instead of ${original}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(info.deletionDate)) {
        throw new Error(`the .trashinfo carries an unusable deletion date: ${info.deletionDate}`);
      }

      // Restoring is the second half of the promise: what the metadata records
      // has to be enough to put the file back where it was, bytes included.
      const restored = await restoreTrashEntry(entry);
      if (restored !== original) throw new Error(`the entry restored ${restored} instead of ${original}`);
      if ((await readIfPresent(original)) !== RECYCLED) {
        throw new Error('the restored file did not come back with its bytes');
      }
      if (await findTrashEntry('reciclado.txt')) {
        throw new Error('the trash still holds an entry for the file that was restored');
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

  for (const testCase of cases) {
    try {
      await testCase.run(attached.page);
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      // One case failing must not hide the others: the point of running four is
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
