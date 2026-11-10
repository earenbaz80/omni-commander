import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import { removeWorkspace } from './support/tempWorkspaces';
import { BOOT_TIMEOUT_MS } from './support/boot';
import path from 'node:path';

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
  await expect(lists.first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

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
 * and nothing else. The dialog element itself is named by the modal shell and
 * audited in `a11y.modals.spec.ts`; the groupings that open *inside* a window
 * get their own case at the end of this file.
 */
const GROUPING_ROLES = [
  'group',
  'radiogroup',
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
  await expect(page.locator('[data-file-list]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

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

/** The panels address storage by drive letter, so naming a file needs one. */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

/** Points the left panel at `folder` and focuses the file the fixture wrote. */
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

interface GroupingInWindow {
  window: string;
  role: string;
  name: string;
  html: string;
}

/** Every grouping container inside the open window, tagged with what opened it. */
async function groupingsInsideWindow(page: Page, windowLabel: string): Promise<GroupingInWindow[]> {
  return page.evaluate(
    ({ roles, windowLabel }) => {
      // Same resolution order the page audit uses, minus the text fallback: a
      // container's own text is its whole content, not a name.
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

      return Array.from(document.querySelectorAll('[role="dialog"]')).flatMap((dialog) =>
        Array.from(dialog.querySelectorAll('[role]'))
          .filter((el) => roles.includes(el.getAttribute('role') || ''))
          .map((el) => ({
            window: windowLabel,
            role: el.getAttribute('role') || '',
            name: nameOf(el),
            html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 140),
          })),
      );
    },
    { roles: GROUPING_ROLES, windowLabel },
  );
}

interface AuditWindow {
  label: string;
  key?: string;
  /** The header menu title and the command inside it. */
  menu?: { title: string; item: RegExp };
  /** A header button that opens the window on its own, found by its title. */
  button?: string;
  /** The subject is the focused entry: without one, there is nothing to show. */
  file?: boolean;
}

/**
 * The windows whose content can hold a grouping.
 *
 * Three are left out on purpose: Uso de Disco walks a real drive and Papelera
 * reads the real recycle bin, so both can take seconds and depend on the
 * machine, and Comparar Archivos reads the selection of both panels at once, so
 * all three need a fixture this audit does not build.
 */
const AUDIT_WINDOWS: AuditWindow[] = [
  { label: 'help', key: 'F1' },
  { label: 'user menu', key: 'F2' },
  { label: 'viewer', key: 'F3', file: true },
  { label: 'editor', key: 'F4', file: true },
  { label: 'copy', key: 'F5', file: true },
  { label: 'move', key: 'F6', file: true },
  { label: 'new folder', key: 'F7' },
  { label: 'delete', key: 'F8', file: true },
  { label: 'search and grep', key: 'Alt+F7' },
  { label: 'quit', key: 'F10' },
  { label: 'batch rename', key: 'Control+M' },
  { label: 'bookmarks', key: 'Control+D' },
  { label: 'settings', button: 'Configuración' },
  { label: 'command library', button: 'Biblioteca de Comandos CMD & Microsoft Winget' },
  { label: 'properties', file: true, menu: { title: 'Archivos', item: /^Propiedades/ } },
  { label: 'zip archive', file: true, menu: { title: 'Archivos', item: /^Comprimir en archivo/ } },
  { label: 'sync folders', menu: { title: 'Comandos', item: /^Sincronizar Carpetas/ } },
  { label: 'file splitter', file: true, menu: { title: 'Comandos', item: /^Dividir \/ Unir Archivo/ } },
  { label: 'background tasks', menu: { title: 'Comandos', item: /^Cola de Tareas/ } },
  { label: 'about', menu: { title: 'Ayuda', item: /^Acerca de OmniCommander/ } },
  { label: 'protect folder', menu: { title: 'Ayuda', item: /^Proteger Carpeta/ } },
];

test('every grouping inside a window is named, like the ones on the page', async ({ page }) => {
  test.skip(
    !hasDriveLetters,
    `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
  );
  test.setTimeout(240000);

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-a11y-windows-'));
  try {
    await fs.writeFile(path.join(workspace, 'nota.txt'), 'una nota\n', 'utf8');

    await page.goto('/');
    await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
    await focusFixtureFile(page, workspace);

    const seen: GroupingInWindow[] = [];
    for (const win of AUDIT_WINDOWS) {
      if (win.key) {
        await page.locator('[data-file-list]').first().focus();
        await page.keyboard.press(win.key);
      } else if (win.menu) {
        const title = page.getByRole('button', { name: win.menu.title, exact: true }).first();
        await title.click();
        // Scoped to the dropdown: the same label names a control elsewhere.
        await title.locator('..').getByRole('button', { name: win.menu.item }).click();
      } else {
        await page
          .getByTitle(win.button ?? '')
          .first()
          .click();
      }

      const dialog = page.getByRole('dialog');
      await expect(dialog, `the ${win.label} window never opened`).toBeVisible({ timeout: 30000 });
      seen.push(...(await groupingsInsideWindow(page, win.label)));

      await page.keyboard.press('Escape');
      await expect(dialog, `the ${win.label} window did not close`).toHaveCount(0);
    }

    // The collision policy of the copy/move window is the one grouping that
    // really lives inside a window. Without it the audit walked empty dialogs
    // and would pass no matter what a window declared.
    expect(
      seen.some((container) => container.role === 'radiogroup'),
      `the audit never saw the collision-policy group:\n${JSON.stringify(seen, null, 2)}`,
    ).toBe(true);

    const unnamed = seen.filter((container) => !container.name);
    expect(unnamed, `Groupings inside windows announced by role alone:\n${JSON.stringify(unnamed, null, 2)}`).toEqual(
      [],
    );
  } finally {
    await removeWorkspace(workspace);
  }
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
    timeout: BOOT_TIMEOUT_MS,
    // Polled rather than rAF (throttled in a background tab), but fine-grained:
    // a coarse interval adds its own delay to every boot this suite waits on.
    polling: 100,
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
