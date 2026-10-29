import { test, expect } from '@playwright/test';

// Pin the UI language so the specs don't break if the app default changes.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

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

test('the file list is a named group, so focus on it is announced', async ({ page }) => {
  await page.goto('/');

  // Both panels render their own list, and focus lands on it every time a
  // window closes back onto it.
  const lists = page.locator('[data-file-list]');
  await expect(lists.first()).toBeVisible({ timeout: 60000 });

  const audit = await lists.evaluateAll((els) =>
    els.map((el) => ({
      role: el.getAttribute('role'),
      name: (el.getAttribute('aria-label') || '').trim(),
      tabIndex: (el as HTMLElement).tabIndex,
    })),
  );

  expect(audit.length).toBeGreaterThanOrEqual(2);
  // A focusable div with no role and no name is announced as nothing at all,
  // which is what a screen reader would have said when a window closed.
  expect(
    audit.filter((list) => list.role !== 'group' || !list.name || list.tabIndex !== 0),
    JSON.stringify(audit, null, 2),
  ).toEqual([]);

  // Each list names its own panel: two panels can mirror the same folder, and
  // then the path alone would announce the same thing on both sides.
  const panels = new Set(
    audit.map((list) => {
      if (list.name.includes('panel izquierdo')) return 'left';
      if (list.name.includes('panel derecho')) return 'right';
      return list.name;
    }),
  );
  expect(panels, JSON.stringify(audit, null, 2)).toEqual(new Set(['left', 'right']));

  await lists.first().focus();
  await expect(lists.first()).toBeFocused();
});

/**
 * Roles that group or landmark something. Unlike a plain div, each of these is
 * announced by name, so a nameless one leaves a screen reader reading "group"
 * and nothing else. Dialogs are named by the modal shell and audited in
 * `a11y.modals.spec.ts`, so they are not repeated here.
 */
const GROUPING_ROLES = [
  'group',
  'region',
  'toolbar',
  'tablist',
  'list',
  'listbox',
  'tree',
  'grid',
  'menu',
  'navigation',
  'main',
  'banner',
  'complementary',
  'contentinfo',
  'search',
  'form',
];

test('every grouping or landmark is named', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-file-list]').first()).toBeVisible({ timeout: 60000 });

  const auditContainers = () =>
    page.evaluate((roles: string[]) => {
      // Same simplified resolution order the button audit uses, minus the text
      // fallback: a container's text is its whole content, not a name.
      const nameOf = (el: Element) => {
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ')
            .trim();
          if (text) return text;
        }
        const title = el.getAttribute('title');
        return title && title.trim() ? title.trim() : '';
      };

      return Array.from(document.querySelectorAll('[role]'))
        .filter((el) => roles.includes(el.getAttribute('role') || ''))
        .map((el) => ({
          role: el.getAttribute('role'),
          name: nameOf(el),
          html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
        }));
    }, GROUPING_ROLES);

  const onLoad = await auditContainers();
  // The two panels' lists alone already prove the query ran.
  expect(onLoad.length).toBeGreaterThanOrEqual(2);

  // A menu only exists while it is open, so the page as loaded would never
  // audit one. This is the only place in the app that declares `role="menu"`.
  const cleanupButton = page.getByTitle('Limpiar carpetas temporales');
  await expect(cleanupButton).toBeVisible({ timeout: 60000 });
  await cleanupButton.click();
  await expect(page.getByRole('menu')).toBeVisible();
  const withMenuOpen = await auditContainers();
  await cleanupButton.click();
  await expect(page.getByRole('menu')).toHaveCount(0);

  expect(
    withMenuOpen.some((container) => container.role === 'menu'),
    'the open menu was never audited',
  ).toBe(true);

  const audit = [...onLoad, ...withMenuOpen];
  expect(
    audit.filter((container) => !container.name),
    `Groupings announced by role alone:\n${JSON.stringify(
      audit.filter((container) => !container.name),
      null,
      2,
    )}`,
  ).toEqual([]);
});

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
  await page.waitForFunction(() => document.querySelectorAll('button[aria-pressed]').length > 20, undefined, {
    timeout: 60000,
    polling: 500,
  });

  const result = (await page.evaluate(AUDIT)) as {
    checked: number;
    nameless: Array<{ cls: string; html: string }>;
  };

  expect(result.checked).toBeGreaterThan(60);
  expect(
    result.nameless,
    `Controls without an accessible name:\n${JSON.stringify(result.nameless, null, 2)}`,
  ).toHaveLength(0);
});
