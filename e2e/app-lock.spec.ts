import { test, expect, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/services/storage';
import crypto from 'node:crypto';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * The lock screen: the one window that stands between the user and everything
 * else, and the only one whose failure is silent until it matters.
 *
 * Three promises are walked here, each through the real interface:
 *
 * 1. Arming the lock from Settings is the whole installation. The screen covers
 *    the window at once -- the settings dialog that armed it included -- and
 *    survives a relaunch, because the record it wrote is in localStorage and the
 *    window reads it back at startup.
 * 2. Only the stored pair opens it. A wrong password, a wrong user and a press
 *    on the close button all leave the screen exactly where it was, and the typed
 *    password is nowhere in the stored JSON: a plaintext one is the single way
 *    this window could betray the user.
 * 3. The lock flag without a credential covers nothing. The lock is refused when
 *    no hash exists, since the alternative is a screen nobody -- the owner
 *    included -- can open, and the old public `admin123` fallback that used to
 *    open it is gone.
 *
 * The password record the app writes is a salt plus a PBKDF2-SHA256 hash, so the
 * spec derives the same record in Node for the case where a lock already exists
 * from a previous session. Deriving it here rather than seeding a legacy
 * plaintext value is what makes the second promise about the real format.
 */

const PASSWORD = 'clave-e2e';
const LOCK_TITLE = 'OmniCommander Pro - Bloqueo de Seguridad';
const SETTINGS_TITLE = 'Configuración del Sistema';

interface StoredLockSettings {
  appLockEnabled?: boolean;
  appUsername?: string;
  appPasswordHash?: string;
  appPasswordSalt?: string;
}

/** A stored record in the shape the app writes: base64 salt + derived hash. */
function passwordRecord(password: string) {
  const salt = crypto.randomBytes(16).toString('base64');
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'base64'), 100_000, 32, 'sha256').toString('base64');
  return { salt, hash };
}

/**
 * Pins the UI language without discarding what the previous session saved: the
 * lock case reloads the page on purpose, and overwriting the stored settings
 * would arm it and disarm it in the same breath.
 */
async function pinLanguage(page: Page) {
  await page.addInitScript((key) => {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const isEnvelope = parsed !== null && typeof parsed === 'object' && 'value' in (parsed as Record<string, unknown>);
    const value = isEnvelope ? (parsed as { value: Record<string, unknown> }).value : parsed;
    const merged = { ...(value as Record<string, unknown> | null), language: 'es' };
    localStorage.setItem(key, JSON.stringify(isEnvelope ? { ...(parsed as object), value: merged } : merged));
  }, SETTINGS_KEY);
}

/** Seeds a whole settings object, as a previous session of the app would leave it. */
async function seedSettings(page: Page, settings: StoredLockSettings) {
  await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), {
    key: SETTINGS_KEY,
    stored: { language: 'es', ...settings },
  });
}

/** The stored settings, unwrapped from the versioned envelope when there is one. */
const storedSettings = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLockSettings & { value?: StoredLockSettings };
    return parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : parsed;
  }, SETTINGS_KEY);

const lockScreen = (page: Page) => page.getByRole('dialog', { name: LOCK_TITLE });
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: SETTINGS_TITLE });

/** Opens Settings on its security tab, the way the toolbar does. */
async function openSecurityTab(page: Page) {
  await page.getByTitle('Configuración').click({ timeout: BOOT_TIMEOUT_MS });
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Seguridad' }).click();
  return dialog;
}

/** Types credentials into the lock screen and submits the form. */
async function signIn(page: Page, user: string, password: string) {
  const lock = lockScreen(page);
  await lock.locator('input[type="text"]').fill(user);
  const pass = lock.locator('input[type="password"]');
  await pass.fill(password);
  await pass.press('Enter');
}

test('arming the lock in Settings covers the window and a relaunch still asks', async ({ page }) => {
  test.setTimeout(120000);
  await pinLanguage(page);
  await page.goto('/');
  await expect(page.locator('[data-name]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await expect(lockScreen(page)).toHaveCount(0);

  const settings = await openSecurityTab(page);
  // With no stored credential the window offers two fields: the password and
  // the confirmation that catches a typo.
  const password = settings.locator('input[type="password"]').nth(0);
  const confirmation = settings.locator('input[type="password"]').nth(1);
  await password.fill(PASSWORD);
  await confirmation.fill(PASSWORD);

  const toggle = settings.getByRole('checkbox', { name: /Proteger la Aplicación con Usuario y Contraseña/ });
  await expect(toggle).toBeEnabled();
  await toggle.check();
  await settings.getByRole('button', { name: 'Guardar' }).click();

  // No relaunch is required: the lock that was just armed is already in force.
  const lock = lockScreen(page);
  await expect(lock).toBeVisible({ timeout: 15000 });

  // ...and it covers the dialog it was armed from, not the other way round.
  const covering = await page.evaluate((name) => {
    const panel = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
    if (!panel) return 'missing';
    const rect = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? 'nothing';
  }, SETTINGS_TITLE);
  expect(covering, 'the settings dialog must not stay reachable under the lock').not.toBe(SETTINGS_TITLE);

  // What was stored is a record, not the password: the shape the lock reads back.
  await expect
    .poll(async () => {
      const stored = await storedSettings(page);
      return `${Boolean(stored?.appPasswordHash)}/${Boolean(stored?.appPasswordSalt)}`;
    })
    .toBe('true/true');
  const stored = await storedSettings(page);
  expect(stored?.appLockEnabled).toBe(true);
  expect(JSON.stringify(stored)).not.toContain(PASSWORD);

  // A relaunch is the case the lock exists for.
  await page.reload();
  await expect(lock).toBeVisible({ timeout: 30000 });

  // A wrong password is refused, and the field is emptied so the next attempt
  // does not submit the same mistake again.
  await signIn(page, 'admin', 'no-es-la-clave');
  await expect(lock.getByText('Usuario o contraseña incorrectos. Reintente.')).toBeVisible();
  await expect(lock.locator('input[type="password"]')).toHaveValue('');
  await expect(lock).toBeVisible();

  await signIn(page, 'admin', PASSWORD);
  await expect(lock).toHaveCount(0);
  await expect(page.locator('[data-file-list]').first()).toBeVisible();
});

test('the lock needs the stored user and password, and cannot be dismissed', async ({ page }) => {
  test.setTimeout(120000);
  const record = passwordRecord(PASSWORD);
  await seedSettings(page, {
    appLockEnabled: true,
    appUsername: 'jefe',
    appPasswordHash: record.hash,
    appPasswordSalt: record.salt,
  });
  await page.goto('/');

  const lock = lockScreen(page);
  await expect(lock).toBeVisible({ timeout: 30000 });

  // Neither the close button nor Escape is a way past a lock: both exist on
  // other dialogs, so they are the two gestures a user will try first.
  await lock.getByRole('button', { name: 'Cancelar' }).click();
  await expect(lock).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lock).toBeVisible();

  const error = lock.getByText('Usuario o contraseña incorrectos. Reintente.');

  // The right password with the wrong user is still a refusal.
  await signIn(page, 'intruso', PASSWORD);
  await expect(error).toBeVisible();
  await expect(lock).toBeVisible();

  // ...and so is the right user with a wrong password.
  await signIn(page, 'jefe', 'no-es-la-clave');
  await expect(error).toBeVisible();
  await expect(lock.locator('input[type="password"]')).toHaveValue('');

  // Typing again clears the warning, so a refusal is not a permanent label.
  await lock.locator('input[type="password"]').fill('otra-vez');
  await expect(error).toHaveCount(0);

  await signIn(page, 'jefe', PASSWORD);
  await expect(lock).toHaveCount(0);
  await expect(page.locator('[data-file-list]').first()).toBeVisible();
});

test('an enabled lock with no password does not lock the app out', async ({ page }) => {
  test.setTimeout(120000);
  // A settings file from an older build can carry the flag without a record.
  await seedSettings(page, { appLockEnabled: true, appUsername: 'admin', appPasswordHash: '' });
  await page.goto('/');

  await expect(page.locator('[data-file-list]').first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await expect(lockScreen(page)).toHaveCount(0);

  // Settings agrees there is nothing to verify against, which is why the flag
  // on its own cannot cover the window.
  const settings = await openSecurityTab(page);
  await expect(settings.locator('input[type="password"]').nth(0)).toHaveAttribute('placeholder', 'Sin contraseña');
});
