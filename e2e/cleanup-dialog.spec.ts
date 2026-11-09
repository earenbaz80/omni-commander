import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * The temporary-folder cleanup window, opened from the toolbar the way a user
 * opens it.
 *
 * It is the other window in the app that removes files for good -- no Recycle
 * Bin, no undo -- and nothing walked it either. What makes it different from the
 * delete dialog is that it never names a file: the user picks one of three
 * folders and an age filter, and the server re-walks the folder and decides what
 * goes. So the promises to check are the dialog's own: it measures before it
 * offers to delete, the first press only asks, the age filter re-measures, and a
 * folder with nothing to offer never reaches the point of deleting.
 *
 * The three cleanup routes are answered here instead of by the real server, and
 * the reason is the point of the feature: running it for real would empty this
 * machine's `%TEMP%`, and the suite is not allowed to ask for elevation or to
 * point the server at a scratch folder -- the target is an id the server
 * resolves, never a path the client sends. The destructive half is therefore
 * covered where it can be run honestly, in `server.cleanup.test.ts`, against a
 * scratch root the test builds; here the answers are fixtures and the subject is
 * the interface built on top of them.
 */

const TOOLBAR_LABEL = 'Limpiar carpetas temporales';
const TARGET_LABEL = 'Tus temporales';
const REAL_PATH = 'C:\\Users\\prueba\\AppData\\Local\\Temp';

interface CleanupCall {
  route: 'scan' | 'run';
  body: Record<string, unknown>;
}

interface Answer {
  status?: number;
  body: Record<string, unknown>;
}

/** Pins the language before the app loads, as the rest of the suite does. */
async function seedSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
}

/**
 * Answers `cleanup/scan` and `cleanup/run` with the given fixtures and records
 * every call, so a case can assert what was asked and in which order. Anything
 * else under that path is left to the app's own server.
 */
async function stubCleanup(
  page: Page,
  answers: { scan: (body: Record<string, unknown>) => Answer; run: (body: Record<string, unknown>) => Answer },
) {
  const calls: CleanupCall[] = [];

  await page.route('**/api/fs/cleanup/**', async (route: Route) => {
    const url = route.request().url();
    const kind = url.endsWith('/scan') ? 'scan' : url.endsWith('/run') ? 'run' : null;
    if (!kind) return route.continue();

    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ route: kind, body });
    const answer = kind === 'scan' ? answers.scan(body) : answers.run(body);
    await route.fulfill({
      status: answer.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(answer.body),
    });
  });

  return calls;
}

/** What a measurement of the folder reports, before anything is removed. */
const scanAnswer = (overrides: Record<string, unknown> = {}): Answer => ({
  body: {
    target: 'user-temp',
    path: REAL_PATH,
    minAgeDays: 0,
    files: 3,
    dirs: 2,
    bytes: 8192,
    skipped: 1,
    truncated: false,
    largest: [
      { name: 'viejo-a.bin', size: 4096, modifiedMs: 0 },
      { name: 'viejo-b.tmp', size: 4096, modifiedMs: 0 },
    ],
    ...overrides,
  },
});

/** What a run reports: what went, how much it freed, and what it could not. */
const runAnswer = (overrides: Record<string, unknown> = {}): Answer => ({
  body: {
    target: 'user-temp',
    path: REAL_PATH,
    minAgeDays: 0,
    freedBytes: 8192,
    deletedFiles: 3,
    deletedDirs: 2,
    failed: [{ path: 'C:\\Users\\prueba\\AppData\\Local\\Temp\\en-uso.log', message: 'EBUSY' }],
    failedCount: 1,
    skipped: 1,
    truncated: false,
    ...overrides,
  },
});

/** Opens the toolbar menu and picks the user's own temp folder. */
async function openCleanup(page: Page) {
  await page.goto('/');

  const toolbar = page.getByTitle(TOOLBAR_LABEL);
  await expect(toolbar).toBeVisible({ timeout: 60000 });
  await toolbar.click();

  const menu = page.getByRole('menu', { name: TOOLBAR_LABEL });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: TARGET_LABEL }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText(/Limpieza de Carpetas Temporales/);
  return dialog;
}

test('it measures first, asks once, and only the second press deletes', async ({ page }) => {
  await seedSettings(page);
  const calls = await stubCleanup(page, { scan: () => scanAnswer(), run: () => runAnswer() });

  await page.goto('/');
  const toolbar = page.getByTitle(TOOLBAR_LABEL);
  await expect(toolbar).toBeVisible({ timeout: 60000 });
  await toolbar.click();

  const menu = page.getByRole('menu', { name: TOOLBAR_LABEL });
  await expect(menu).toBeVisible();
  // The menu offers all three folders but only the user's is reachable without
  // an elevated token; the two the server would refuse say why instead of
  // opening a window that only fails later.
  await expect(menu.getByRole('menuitem', { name: 'Temporales de Windows' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Temporales de Windows' })).toHaveAttribute(
    'title',
    'Requiere administrador',
  );
  await expect(menu.getByRole('menuitem', { name: 'Prefetch (Windows)' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: TARGET_LABEL }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);

  // The measurement: what the folder holds and where the server resolved it,
  // before a single entry is touched.
  await expect(dialog).toContainText(REAL_PATH);
  await expect(dialog).toContainText(/3 archivos · 2 carpetas · 8\.0 KB/);
  await expect(dialog).toContainText(/1 elementos omitidos/);
  await expect(dialog).toContainText('viejo-a.bin');
  await expect(dialog).toContainText('viejo-b.tmp');

  const clean = dialog.getByRole('button', { name: 'Limpiar ahora' });
  await expect(clean).toBeEnabled();
  await clean.click();

  // The first press is a question, and it has to be a question without a
  // request behind it: a confirmation that already deleted would be theatre.
  await expect(dialog).toContainText(/No pasa por la Papelera/);
  expect(calls.filter((call) => call.route === 'run')).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).not.toContainText(/No pasa por la Papelera/);
  expect(calls.filter((call) => call.route === 'run')).toHaveLength(0);

  await clean.click();
  await dialog.getByRole('button', { name: 'Sí, limpiar' }).click();

  // The second press is the one that empties, and the result reports what went
  // and what another program held on to.
  await expect(dialog).toContainText('Limpieza terminada');
  await expect(dialog).toContainText('Liberado 8.0 KB');
  await expect(dialog).toContainText('Borrados 3 archivos y 2 carpetas');
  await expect(dialog).toContainText(/No se pudieron borrar 1/);
  await expect(dialog).toContainText(/EBUSY/);

  const runs = calls.filter((call) => call.route === 'run');
  expect(runs).toHaveLength(1);
  expect(runs[0].body).toEqual({ target: 'user-temp', minAgeDays: 0 });
});

test('the age filter measures the folder again instead of reusing the count', async ({ page }) => {
  await seedSettings(page);
  const calls = await stubCleanup(page, {
    scan: (body) =>
      body.minAgeDays === 7
        ? scanAnswer({ minAgeDays: 7, files: 9, dirs: 0, bytes: 2048, skipped: 0, largest: [] })
        : scanAnswer(),
    run: () => runAnswer(),
  });

  const dialog = await openCleanup(page);
  await expect(dialog).toContainText(/3 archivos · 2 carpetas · 8\.0 KB/);

  await dialog.getByRole('button', { name: 'Más de una semana' }).click();

  // A stale summary here would be the worst kind: the user would confirm one
  // number and the server would delete another.
  await expect(dialog).toContainText(/9 archivos · 0 carpetas · 2\.0 KB/);

  const scans = calls.filter((call) => call.route === 'scan');
  // The dev server mounts the window twice, so the first measurement can appear
  // twice; what matters is that the new filter was asked for its own count.
  expect(scans[scans.length - 1].body.minAgeDays).toBe(7);
  expect(scans.filter((call) => call.body.minAgeDays === 7)).toHaveLength(1);
  expect(scans.some((call) => call.body.minAgeDays === 0)).toBe(true);
});

test('a folder with nothing to offer cannot reach the point of deleting', async ({ page }) => {
  await seedSettings(page);
  const calls = await stubCleanup(page, {
    scan: () => scanAnswer({ files: 0, dirs: 0, bytes: 0, skipped: 0, largest: [] }),
    run: () => runAnswer(),
  });

  const dialog = await openCleanup(page);
  await expect(dialog).toContainText('No hay nada que cumpla este filtro');

  // The button is still there and cannot be pressed: hiding it would leave the
  // user wondering where the action went.
  await expect(dialog.getByRole('button', { name: 'Limpiar ahora' })).toBeDisabled();
  expect(calls.filter((call) => call.route === 'run')).toHaveLength(0);
});

test('a folder the server cannot read says so and offers no action', async ({ page }) => {
  await seedSettings(page);
  await stubCleanup(page, {
    scan: () => ({ status: 500, body: { error: 'EACCES: permiso denegado' } }),
    run: () => runAnswer(),
  });

  const dialog = await openCleanup(page);
  await expect(dialog).toContainText('No se pudo leer la carpeta');
  await expect(dialog).toContainText(/EACCES/);

  // A failed measurement is not an empty folder, so there is nothing to clean.
  await expect(dialog.getByRole('button', { name: 'Limpiar ahora' })).toHaveCount(0);
  // The shell carries its own close button, so this is the footer one.
  await expect(dialog.getByRole('button', { name: 'Cerrar' }).last()).toBeVisible();
});
