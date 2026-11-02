import { test, expect } from '@playwright/test';

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
  await page.addInitScript(() => {
    // Other specs pin the language this way; the labels below are Spanish.
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));

    const snapshot = {
      status: 'up-to-date',
      version: null,
      percent: 0,
      error: null,
      enabled: true,
      channel: 'stable',
    };
    const bridge = window as unknown as { electronAPI?: Record<string, unknown> };
    bridge.electronAPI = {
      getUpdateState: async () => snapshot,
      checkForUpdates: async () => snapshot,
      // The main process applies the switch before answering, so the snapshot
      // that comes back already says which feed is in force.
      setUpdateChannel: async (channel: string) => ({ ...snapshot, channel }),
      onUpdateState: () => () => {},
    };
  });
});

test('the updates card offers the beta channel and asks for no credential', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');

  await page.getByTitle('Configuración').click({ timeout: 60000 });
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
});
