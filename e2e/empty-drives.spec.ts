import { test, expect } from '@playwright/test';
import { SETTINGS_KEY } from '../src/services/storage';
import { BOOT_TIMEOUT_MS } from './support/boot';

/**
 * A boot whose drive probe never gets an answer.
 *
 * The list the app opens with is the previous session's cache, so this boot does
 * paint a drive and a tab on it. Once the probe has spent its retries and still
 * has no answer, that cached drive is not a machine the app can list: the panel
 * has to say there are no drives instead of leaving a file view whose empty state
 * offers a drop target for a folder the server would not describe.
 *
 * The server is up and only `/api/drives` fails. That is the shape of the report
 * behind this case: the app hung on a drive that was never there while every
 * other call answered.
 */
const CACHED_DRIVE = {
  id: 'real_C',
  letter: 'C:',
  name: 'Windows',
  type: 'local',
  totalBytes: 100,
  freeBytes: 40,
  isMounted: true,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ drive, key }: { drive: unknown; key: string }) => {
      localStorage.setItem(key, JSON.stringify({ language: 'es' }));
      // Written with the wrapper `nc_drives_v1` uses today, the way the storage
      // spec does, so this reads as a list a previous run really left.
      localStorage.setItem('nc_drives_v1', JSON.stringify({ version: 1, value: [drive] }));
    },
    { drive: CACHED_DRIVE, key: SETTINGS_KEY },
  );
});

test('reports no drives when the drive probe never answers', async ({ page }) => {
  test.setTimeout(120000);
  // The probe is held until this test has seen the cached list on screen, so the
  // case cannot pass on whichever of the two happened to paint first: it pins the
  // order that matters, a drive shown from the cache and then taken away.
  let answerProbe: () => void = () => {};
  const probeHeld = new Promise<void>((resolve) => {
    answerProbe = resolve;
  });

  // A 5xx is retried: three attempts and the 500 ms and 1 s backoffs, then the
  // read gives up and reports that it has no answer.
  await page.route('**/api/drives', async (route) => {
    await probeHeld;
    // An attempt the client abandoned after its 10 s timeout is fulfilled into
    // nothing, which is not this test's failure.
    await route.fulfill({ status: 500, body: 'no' }).catch(() => {});
  });

  await page.goto('/');

  // The drive pill is the cached list made visible: `[C:]`, titled with the
  // letter, the name and the free space the seeded entry carries.
  await expect(page.getByTitle(/^C: Windows/).first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  answerProbe();

  const notice = page.locator('[data-no-drives]');
  await expect(notice.first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await expect(notice.first()).toContainText('Sin unidades reales detectadas');
  await expect(notice.first()).toContainText('No se detectaron unidades reales en este sistema');
  // The cache is not merely hidden behind the notice: the pill is gone.
  await expect(page.getByTitle(/^C: Windows/)).toHaveCount(0);

  // The file view's empty state describes a folder that exists and holds
  // nothing. Here no drive was ever confirmed, so it must not be on screen.
  await expect(page.getByText('Carpeta vacía')).toHaveCount(0);
});
