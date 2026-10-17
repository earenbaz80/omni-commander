import { test, expect } from '@playwright/test';

/**
 * Accessibility audit: every visible interactive control must expose an
 * accessible name. The computation mirrors the browser's simplified name
 * resolution order (aria-label -> aria-labelledby -> text -> title -> img alt).
 */
const AUDIT = `(() => {
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
  const els = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(e => e.offsetParent !== null && !e.closest('[aria-hidden="true"]'));
  const nameless = els.filter(e => !accName(e));
  return {
    checked: els.length,
    nameless: nameless.map(e => ({
      cls: (e.className || '').toString().replace(/\\s+/g, ' ').slice(0, 90),
      html: e.outerHTML.replace(/\\s+/g, ' ').slice(0, 160),
    })),
  };
})()`;

test('every visible button has an accessible name', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');

  // The app boots into an empty state, then lists the real drives and only then
  // renders the file rows (which carry dozens of per-row controls). Wait for
  // those rows specifically before auditing.
  // Wait for the per-row selection checkboxes to exist. They are the only
  // elements in the app carrying aria-pressed, so this hook is structural
  // (no style classes) and language independent. polling keeps it alive even
  // when requestAnimationFrame is throttled.
  await page.waitForFunction(
    () => document.querySelectorAll('button[aria-pressed]').length > 20,
    undefined,
    { timeout: 60000, polling: 500 }
  );

  const result = (await page.evaluate(AUDIT)) as {
    checked: number;
    nameless: Array<{ cls: string; html: string }>;
  };

  expect(result.checked).toBeGreaterThan(60);
  expect(
    result.nameless,
    `Controls without an accessible name:\n${JSON.stringify(result.nameless, null, 2)}`
  ).toHaveLength(0);
});
