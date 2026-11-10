import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeWorkspace } from './support/tempWorkspaces';

// Pin the UI language so the specs don't break if the app default changes.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

/**
 * Accessibility audit for modals: open each modal, then verify every visible
 * control inside the dialog exposes an accessible name.
 */

const ACC_NAME = `
  function accName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (txt) return txt;
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const img = el.querySelector('img[alt]');
    if (img && (img.getAttribute('alt') || '').trim()) return img.getAttribute('alt').trim();
    return '';
  }
`;

const DIALOG_AUDIT = `(() => {
  ${ACC_NAME}
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return { opened: false, checked: 0, nameless: [] };
  const els = Array.from(dialog.querySelectorAll('button, [role="button"]'))
    .filter(e => e.offsetParent !== null);
  const nameless = els.filter(e => !accName(e)).map(e => ({
    cls: (e.className || '').toString().replace(/\\s+/g, ' ').slice(0, 80),
    html: e.outerHTML.replace(/\\s+/g, ' ').slice(0, 140),
  }));
  return { opened: true, checked: els.length, nameless };
})()`;

/**
 * Windows that a key opens with nothing focused.
 *
 * The editor is not one of them: F4 only opens over a focused entry, so it gets
 * its own case, over a scratch file, at the end of this file.
 */
const KEY_MODALS: Array<[string, string]> = [
  ['help', 'F1'],
  ['user_menu', 'F2'],
  ['viewer', 'F3'],
  ['copy', 'F5'],
  ['move', 'F6'],
  ['mkdir', 'F7'],
  ['delete', 'F8'],
  ['quit', 'F10'],
  ['search_grep', 'Alt+F7'],
  ['batch_rename', 'Control+m'],
  ['hotlist_bookmarks', 'Control+d'],
];

/**
 * The windows behind a header control. There is no cloud-manager button in the
 * interface, so nothing here may name one: an entry that cannot be clicked
 * spends its whole timeout and audits nothing.
 */
const TOOLBAR_MODALS: Array<[string, string]> = [
  ['settings', 'Configuración'],
  ['cmd_winget', 'Biblioteca de Comandos CMD & Microsoft Winget'],
  ['properties', 'Propiedades (Alt+Enter)'],
];

/**
 * Loads the page and waits for the per-row selection checkboxes.
 *
 * They are the only elements in the app carrying aria-pressed, so this hook is
 * structural (no style classes) and language independent. Polled, not left to
 * rAF (which is throttled in a background tab), but tight enough that a boot
 * which takes 1.2 s does not cost the extra 0.5 s a coarse interval adds on top
 * of it.
 */
async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('button[aria-pressed]').length > 20, undefined, {
    timeout: 60000,
    polling: 100,
  });
}

/** The panels address storage by drive letter, so opening the editor needs one. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

/** Points the left panel at `folder` and focuses the file written there. */
async function focusFixtureFile(page: Page, folder: string) {
  await page.locator('[data-path-bar]').nth(0).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(folder);
  await input.press('Enter');

  const row = page.locator('[data-name="nota.txt"]').first();
  await expect(row).toBeVisible();
  await row.click();
}

/**
 * Waits for the state the audit is about to read instead of sleeping through it.
 *
 * A flat 200 ms before and after every window was both the largest cost of this
 * case and too short to be an audit: a dialog takes around 300 ms to mount
 * here, so most windows were read while the page still had none, reported
 * `opened: false`, and asserted nothing. Waiting for the panel itself is
 * cheaper than the sleep was and actually sees the window.
 *
 * Both directions keep the original tolerance, since a key that opens nothing
 * is an answer here (the audit reports `opened: false`), not a failure.
 */
async function waitForDialog(page: Page, present: boolean) {
  await page
    .waitForFunction((want) => Boolean(document.querySelector('[role="dialog"]')) === want, present, {
      timeout: 5000,
      polling: 50,
    })
    .catch(() => {});
}

async function openAndAudit(page: Page, open: () => Promise<void>) {
  try {
    await open();
  } catch {
    return { opened: false, checked: 0, nameless: [] };
  }
  await waitForDialog(page, true);
  const result = (await page.evaluate(DIALOG_AUDIT)) as {
    opened: boolean;
    checked: number;
    nameless: Array<{ cls: string; html: string }>;
  };
  await page.keyboard.press('Escape');
  await waitForDialog(page, false);
  return result;
}

test('every modal control has an accessible name', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);

  const problems: Array<{ modal: string; nameless: Array<{ cls: string; html: string }> }> = [];
  const unopened: string[] = [];

  for (const [name, key] of KEY_MODALS) {
    const r = await openAndAudit(page, () => page.keyboard.press(key));
    if (!r.opened) unopened.push(name);
    if (r.opened && r.nameless.length) problems.push({ modal: name, nameless: r.nameless });
  }

  for (const [name, title] of TOOLBAR_MODALS) {
    const r = await openAndAudit(page, () => page.getByTitle(title).first().click({ timeout: 5000 }));
    if (!r.opened) unopened.push(name);
    if (r.opened && r.nameless.length) problems.push({ modal: name, nameless: r.nameless });
  }

  // An audit of a window that was not on screen asserts nothing, and that is
  // how this case passed for years: the wait before it was shorter than the
  // mount. A window that fails to open is a failure here, not a skip.
  expect(unopened, 'these windows never opened, so nothing inside them was audited').toEqual([]);
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
});

/**
 * The one window with a subject: the editor reads the bytes of the focused
 * entry, so F4 over an empty list opens nothing and a bare key press can never
 * reach it. The scratch file is what makes the window, and its toolbar, real.
 */
test('the editor opened over a file names every control', async ({ page }) => {
  test.skip(
    !hasDriveLetters,
    `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
  );
  test.setTimeout(120000);

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-a11y-editor-'));
  try {
    await fs.writeFile(path.join(workspace, 'nota.txt'), 'una nota\n', 'utf8');
    await boot(page);
    await focusFixtureFile(page, workspace);

    const r = await openAndAudit(page, () => page.keyboard.press('F4'));
    expect(r.opened, 'the editor never opened over the focused file').toBe(true);
    expect(r.checked, 'the editor window held no visible control to audit').toBeGreaterThan(0);
    expect(r.nameless, `Controls without an accessible name:\n${JSON.stringify(r.nameless, null, 2)}`).toEqual([]);
  } finally {
    await removeWorkspace(workspace);
  }
});
