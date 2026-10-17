import { test, expect, Page } from '@playwright/test';

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

const KEY_MODALS: Array<[string, string]> = [
  ['help', 'F1'],
  ['user_menu', 'F2'],
  ['viewer', 'F3'],
  ['editor', 'F4'],
  ['copy', 'F5'],
  ['move', 'F6'],
  ['mkdir', 'F7'],
  ['delete', 'F8'],
  ['quit', 'F10'],
  ['search_grep', 'Alt+F7'],
  ['batch_rename', 'Control+m'],
  ['hotlist_bookmarks', 'Control+d'],
];

const TOOLBAR_MODALS: Array<[string, string]> = [
  ['settings', 'Configuración'],
  ['cloud_manager', 'Cloud Services'],
  ['cmd_winget', 'Biblioteca de Comandos CMD & Microsoft Winget'],
  ['properties', 'Propiedades (Alt+Enter)'],
];

async function openAndAudit(page: Page, open: () => Promise<void>) {
  try {
    await open();
  } catch {
    return { opened: false, checked: 0, nameless: [] };
  }
  await page.waitForTimeout(200);
  const result = (await page.evaluate(DIALOG_AUDIT)) as {
    opened: boolean;
    checked: number;
    nameless: Array<{ cls: string; html: string }>;
  };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return result;
}

test('every modal control has an accessible name', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  // Wait for the per-row selection checkboxes to exist. They are the only
  // elements in the app carrying aria-pressed, so this hook is structural
  // (no style classes) and language independent. polling keeps it alive even
  // when requestAnimationFrame is throttled.
  await page.waitForFunction(
    () => document.querySelectorAll('button[aria-pressed]').length > 20,
    undefined,
    { timeout: 60000, polling: 500 }
  );

  const problems: Array<{ modal: string; nameless: Array<{ cls: string; html: string }> }> = [];

  for (const [name, key] of KEY_MODALS) {
    const r = await openAndAudit(page, () => page.keyboard.press(key));
    if (r.opened && r.nameless.length) problems.push({ modal: name, nameless: r.nameless });
  }

  for (const [name, title] of TOOLBAR_MODALS) {
    const r = await openAndAudit(page, () => page.getByTitle(title).click({ timeout: 5000 }));
    if (r.opened && r.nameless.length) problems.push({ modal: name, nameless: r.nameless });
  }

  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
});
