import { test, expect, type Page } from '@playwright/test';

/**
 * Every command in the header's Comandos menu opens the window it names.
 *
 * This menu used to send ids the host never renders — `batchRename`,
 * `searchGrep`, `diffCompare`, `diskUsage`, `userMenu` — so five of its entries
 * closed the menu and did nothing. Two of them stayed invisible because their
 * shortcuts worked (Ctrl+M, Alt+F7); Comparar Archivos has no shortcut, so that
 * window was unreachable from the interface at all.
 *
 * The union now has one spelling per window, which makes the mistake a compile
 * error. This case is the other half: it clicks each entry and demands a window
 * with the right name, so a future id that compiles but renders nothing — a new
 * window added to the type and forgotten in the host — is caught by running the
 * app, not by reading the type.
 */

// Pin the UI language so the labels driven below don't move with the default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

/** Waits for the file lists, the structural signal that the app is interactive. */
async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('button[aria-pressed]').length > 20, undefined, {
    timeout: 60000,
    polling: 500,
  });
}

/**
 * Which title hosts each command, the entry as it reads now, and the window it
 * must open. Renombrado Masivo is under Archivos; the rest under Comandos.
 */
const COMMANDS: Array<{ menu: string; item: RegExp; window: RegExp }> = [
  { menu: 'Archivos', item: /^Renombrado Masivo/, window: /^Herramienta de Renombrado Masivo/ },
  { menu: 'Comandos', item: /^Buscar Archivos \/ Grep/, window: /^Búsqueda Avanzada de Archivos/ },
  { menu: 'Comandos', item: /^Comparar Archivos/, window: /^Comparador de Archivos/ },
  { menu: 'Comandos', item: /^Uso de Disco/, window: /^Analizador de Espacio en Disco/ },
  { menu: 'Comandos', item: /^Menú Usuario/, window: /^Menú de Acciones Rápidas del Usuario/ },
];

test('every Comandos command opens the window it names', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);

  const dialogs = page.getByRole('dialog');

  for (const command of COMMANDS) {
    const menuTitle = page.getByRole('button', { name: command.menu, exact: true }).first();
    await menuTitle.click();
    await menuTitle.locator('..').getByRole('button', { name: command.item }).click();

    await expect(dialogs, `"${command.item}" opened no window`).toHaveCount(1);
    await expect(dialogs).toHaveAccessibleName(command.window);

    // Close before the next entry, so a window left behind cannot answer for it.
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(0);
  }
});

/**
 * The function bar's F2 button carried the same wrong id, so it was dead while
 * the F2 key (which went through the keyboard engine with the right one) worked.
 */
test('the F2 button on the function bar opens the user menu', async ({ page }) => {
  test.setTimeout(60000);
  await boot(page);

  await page.getByRole('button', { name: /^2\s*Menú Usuario$/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAccessibleName(/^Menú de Acciones Rápidas del Usuario/);
});
