import { test, expect, type Page } from '@playwright/test';

/**
 * Where focus lands when a window opens, and where it goes back to when the
 * window closes.
 *
 * Both are `ModalShell`'s job: it names its panel, marks it modal, keeps Tab
 * inside it and restores whatever had focus before mounting. Every modal used to
 * ask for that a second time on a panel nested inside the shell's, and those
 * duplicate hooks were removed — so this spec is the check that removing them
 * left no window opening with focus nowhere, or with two traps fighting over
 * the same Tab.
 *
 * The assertions read `document.activeElement` and describe it, so a failure
 * says which element took focus rather than "focus was wrong".
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

interface FocusInfo {
  tag: string;
  text: string;
  insideDialog: boolean;
  named: boolean;
}

/** Everything a failure message needs about whatever holds focus right now. */
async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: el ? el.tagName.toLowerCase() : 'none', text: '', insideDialog: false, named: false };
    }
    // An icon-only button is named by its title as much as by its text, and the
    // toolbar is full of them, so all three sources count for the message.
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      tag: el.tagName.toLowerCase(),
      text: label.slice(0, 60),
      insideDialog: !!el.closest('[role="dialog"]'),
      named: label.length > 0,
    };
  });
}

/**
 * Windows that a person opens with a key and that need nothing selected first.
 * The point is coverage across different bodies, not every window in the app.
 */
const KEY_WINDOWS: Array<[string, string]> = [
  ['help', 'F1'],
  ['user menu', 'F2'],
  ['new folder', 'F7'],
  ['search and grep', 'Alt+F7'],
];

for (const [label, key] of KEY_WINDOWS) {
  test(`focus enters the ${label} window and stays inside it`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-name]').first()).toBeVisible();

    await page.keyboard.press(key);

    // One dialog, not two: the shell owns it and the body no longer claims one.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();

    const landed = await focusInfo(page);
    expect(landed, `the ${label} window opened with focus on <${landed.tag}> "${landed.text}"`).toMatchObject({
      insideDialog: true,
      named: true,
    });
    // A focused container would technically be "inside" while telling a screen
    // reader nothing, so the landing spot has to be a real control.
    expect(['button', 'input', 'select', 'textarea', 'a']).toContain(landed.tag);

    // Tab is trapped by the shell's own panel, which still wraps the body.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await focusInfo(page)).toMatchObject({ insideDialog: true });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('closing a window hands focus back to the control that opened it', async ({ page }) => {
  await page.goto('/');

  const opener = page.getByTitle('Configuración');
  await expect(opener).toBeVisible({ timeout: 60000 });
  await opener.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  expect(await focusInfo(page)).toMatchObject({ insideDialog: true });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The shell remembered the opener on mount and put focus back on unmount;
  // without that, the next keystroke would land on the document body.
  const back = await focusInfo(page);
  expect(back.insideDialog, `focus ended on <${back.tag}> "${back.text}"`).toBe(false);
  await expect(opener, 'the control that opened the window has to be the one focused again').toBeFocused();
});
