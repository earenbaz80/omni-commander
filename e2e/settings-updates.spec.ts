import { test, expect } from '@playwright/test';
import { SETTINGS_KEY } from '../src/services/storage';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * The Updates card, now that updating needs no credentials.
 *
 * It used to hold a read-only GitHub token: a text field, a button to save it, a
 * button to clear it and a line saying when it expired, plus a warning in About.
 * All of that existed because the repository was private and the release feed
 * answered 404 without one. The repository is public, so the card keeps only the
 * beta switch — and this spec is the guard against a credential quietly coming
 * back: it renders the real component and looks for the controls that would mean
 * somebody is being asked for a token.
 *
 * The suite runs the web build, which has no main process, so `electronAPI` is
 * given the smallest bridge the card needs to render at all. Nothing else in the
 * app reads it: file access goes through the API server.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    // Other specs pin the language this way; the labels below are Spanish.
    localStorage.setItem(key, JSON.stringify({ language: 'es' }));

    const snapshot = {
      status: 'up-to-date',
      version: null,
      percent: 0,
      error: null,
      enabled: true,
      channel: 'stable',
    };
    const bridge = window as unknown as {
      electronAPI?: Record<string, unknown>;
      __updateChecks?: number;
      __updateDownloads?: number;
      __updateFound?: boolean;
    };
    bridge.__updateChecks = 0;
    bridge.__updateDownloads = 0;
    // What this run's feed holds. An empty one is the default, so the card has
    // nothing to offer; the download case asks for a release and gets this.
    const release = { ...snapshot, status: 'available', version: '1.0.9' };
    bridge.electronAPI = {
      // Idle until asked, so the manual check has an outcome to change.
      getUpdateState: async () => ({ ...snapshot, status: 'idle' }),
      checkForUpdates: async () => {
        bridge.__updateChecks = (bridge.__updateChecks ?? 0) + 1;
        return bridge.__updateFound ? release : snapshot;
      },
      // The simulated transfer finishes at once: the main process answers a
      // download with the state it reached, and that answer is what has to turn
      // the card's download button into the restart.
      downloadUpdate: async () => {
        bridge.__updateDownloads = (bridge.__updateDownloads ?? 0) + 1;
        return { ...release, status: 'downloaded' };
      },
      // The main process applies the switch before answering, so the snapshot
      // that comes back already says which feed is in force. Switching the feed
      // is not a check, so the status stays idle.
      setUpdateChannel: async (channel: string) => ({ ...snapshot, channel, status: 'idle' }),
      onUpdateState: () => () => {},
    };
  }, SETTINGS_KEY);
});

test('the updates card offers the beta channel and asks for no credential', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');

  await page.getByTitle('Configuración').click({ timeout: BOOT_TIMEOUT_MS });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Seguridad' }).click();

  const heading = dialog.getByRole('heading', { name: 'Actualizaciones' });
  await expect(heading).toBeVisible();

  // SectionCard renders `div > h4 + div`, so the card is the heading's parent.
  const card = heading.locator('xpath=..');

  const beta = card.getByRole('checkbox', { name: 'Recibir versiones beta' });
  await expect(beta).toBeVisible();
  await expect(beta).not.toBeChecked();

  // A credential would be a text field, and the card must have none.
  await expect(card.getByRole('textbox')).toHaveCount(0);

  // Nor may anything in the window name a token: a label, a placeholder, a
  // title or an accessible name would all be a way of asking for one.
  await expect(dialog.getByText(/token/i)).toHaveCount(0);
  const named = await dialog
    .locator('[aria-label], [placeholder], [title]')
    .evaluateAll((elements) =>
      elements
        .map(
          (element) =>
            `${element.getAttribute('aria-label')} ${element.getAttribute('placeholder')} ${element.getAttribute('title')}`,
        )
        .filter((text) => /token/i.test(text)),
    );
  expect(named, 'a control is asking for a token again').toEqual([]);

  // The switch that survived still works, so the card is not merely present.
  await beta.check();
  await expect(dialog.getByText('Siguiendo el canal beta')).toBeVisible();
  await expect(beta).toBeChecked();

  // The card also runs the check on demand, and says what it found: the same
  // answer the About box gives when nobody asked for a chip in the header.
  const check = dialog.getByRole('button', { name: 'Buscar actualizaciones' });
  await expect(dialog.getByText('Ya tienes la última versión')).toHaveCount(0);
  await check.click();

  await expect(dialog.getByText('Ya tienes la última versión')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __updateChecks?: number }).__updateChecks),
    'the press has to reach the updater, not only change a label',
  ).toBe(1);
});

/**
 * The card's two actions, which exist so the update never sends the user to the
 * header for the only click it needs: the release the check finds is downloaded
 * from the card, and the finished download is what turns that button into the
 * restart.
 */
test('the card downloads the update it finds, then offers the restart', async ({ page }) => {
  test.setTimeout(120000);
  // This run's feed holds a release, so the check has something to hand the card
  // and the card something to act on.
  await page.addInitScript(() => {
    (window as unknown as { __updateFound?: boolean }).__updateFound = true;
  });
  await page.goto('/');

  await page.getByTitle('Configuración').click({ timeout: BOOT_TIMEOUT_MS });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Seguridad' }).click();

  const card = dialog.getByRole('heading', { name: 'Actualizaciones' }).locator('xpath=..');
  // Nothing to restart until a transfer has finished.
  await expect(card.getByRole('button', { name: 'Reiniciar e instalar' })).toHaveCount(0);

  await card.getByRole('button', { name: 'Buscar actualizaciones' }).click();
  await expect(card.getByText('Versión 1.0.9 disponible')).toBeVisible();

  await card.getByRole('button', { name: 'Descargar' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { __updateDownloads?: number }).__updateDownloads),
    'the press has to reach the updater, not only change a label',
  ).toBe(1);

  // A finished transfer is a state the card reports as well as a button it
  // offers: the button on its own read as if the download were still to come.
  await expect(card.getByText('Actualización lista para instalar')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Descargar' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible();
});

/**
 * The whole cycle, not only the two clicks: a check finds a release, the card
 * downloads it, the restart hands it to the installer, and the copy that comes
 * back up is the new version — so the same feed no longer offers that release.
 *
 * The feed and the installer are the smallest bridge that reproduces the states
 * the main process produces; the restart is a reload because the web build has
 * no process to quit. What this pins is the order the user sees: the progress
 * while the transfer runs, the restart only after it finished, and a restarted
 * copy that is up to date even before anyone asks again.
 */
test('walks the update cycle from the feed to the restarted copy', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const bridge = window as unknown as {
      electronAPI?: Record<string, unknown>;
      __updateChecks?: number;
      __updateDownloads?: number;
      __updateInstalls?: number;
    };
    // The fake feed answers for the copy that is running: until the installer
    // has replaced it, the release is still ahead; afterwards it is the version
    // already in place.
    const installed = () => localStorage.getItem('__updateInstalled') === '1';
    const snapshot = (patch: Record<string, unknown> = {}) => ({
      status: 'idle',
      version: null,
      percent: 0,
      error: null,
      enabled: true,
      channel: 'stable',
      ...patch,
    });
    let push: ((value: unknown) => void) | null = null;

    bridge.__updateChecks = 0;
    bridge.__updateDownloads = 0;
    bridge.__updateInstalls = 0;
    bridge.electronAPI = {
      getUpdateState: async () => (installed() ? snapshot({ status: 'up-to-date' }) : snapshot()),
      checkForUpdates: async () => {
        bridge.__updateChecks = (bridge.__updateChecks ?? 0) + 1;
        return installed() ? snapshot({ status: 'up-to-date' }) : snapshot({ status: 'available', version: '1.0.9' });
      },
      downloadUpdate: async () => {
        bridge.__updateDownloads = (bridge.__updateDownloads ?? 0) + 1;
        // The progress the card reports while the transfer runs; the promise
        // then answers with the state the download reached, as the main process
        // does. The pause is what lets the progress be seen at all.
        push?.(snapshot({ status: 'downloading', version: '1.0.9', percent: 42 }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        return snapshot({ status: 'downloaded', version: '1.0.9', percent: 100 });
      },
      installUpdate: async () => {
        bridge.__updateInstalls = (bridge.__updateInstalls ?? 0) + 1;
        // The installer replaces the copy and the app comes back on the new
        // version: the next launch must not offer the same release again.
        localStorage.setItem('__updateInstalled', '1');
        return true;
      },
      setUpdateChannel: async (channel: string) => snapshot({ channel }),
      onUpdateState: (callback: (value: unknown) => void) => {
        push = callback;
        return () => {};
      },
    };
  });
  await page.goto('/');

  await page.getByTitle('Configuración').click({ timeout: BOOT_TIMEOUT_MS });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Seguridad' }).click();

  const card = dialog.getByRole('heading', { name: 'Actualizaciones' }).locator('xpath=..');

  // Check: the feed has a release and the card names it.
  await card.getByRole('button', { name: 'Buscar actualizaciones' }).click();
  await expect(card.getByText('Versión 1.0.9 disponible')).toBeVisible();

  // Download: the transfer is reported while it runs, and the finished download
  // is what turns the button into the restart.
  await card.getByRole('button', { name: 'Descargar' }).click();
  await expect(card.getByText('Descargando 42%')).toBeVisible();
  await expect(card.getByText('Actualización lista para instalar')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __updateDownloads?: number }).__updateDownloads),
    'the press has to reach the updater, not only change a label',
  ).toBe(1);

  // Restart: the button hands the finished download to the installer.
  await card.getByRole('button', { name: 'Reiniciar e instalar' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { __updateInstalls?: number }).__updateInstalls),
    'the restart has to reach the installer, not only close the card',
  ).toBe(1);

  // The app comes back up on the new version: a reload is the web build's
  // restart, and the copy that starts is already up to date — the release is
  // behind it, not merely hidden until the next click.
  await page.reload();
  await page.getByTitle('Configuración').click({ timeout: BOOT_TIMEOUT_MS });
  const restarted = page.getByRole('dialog');
  await expect(restarted).toBeVisible({ timeout: 30000 });
  await restarted.getByRole('button', { name: 'Seguridad' }).click();

  const restartedCard = restarted.getByRole('heading', { name: 'Actualizaciones' }).locator('xpath=..');
  await expect(restartedCard.getByText('Ya tienes la última versión')).toBeVisible();
  await expect(restartedCard.getByRole('button', { name: 'Descargar' })).toHaveCount(0);
  await expect(restartedCard.getByRole('button', { name: 'Reiniciar e instalar' })).toHaveCount(0);

  // Asking again agrees, so the new state is the feed's answer and not a stale
  // label left on screen.
  await restartedCard.getByRole('button', { name: 'Buscar actualizaciones' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { __updateChecks?: number }).__updateChecks),
    'the restarted copy has to ask the feed again, not only remember the old answer',
  ).toBe(1);
  await expect(restartedCard.getByText('Ya tienes la última versión')).toBeVisible();
});
