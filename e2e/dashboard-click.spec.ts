import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeWorkspace } from './support/tempWorkspaces';

/**
 * jsdom delivers the events a test hands it, so it cannot show that Chromium drops
 * the click when the pressed button is replaced between press and release: that
 * decision is the browser's, taken before the page is told anything. Only a real
 * renderer with a real mouse can hold a button across a repaint and see whether the
 * action arrived -- which is how the bug was found, after a jsdom case had approved
 * it.
 */

// The API the suite's own webServer runs on: pinned through the environment, or the
// second port the config reserved for this run.
const pinnedApiPort = Number(process.env.OMNI_API_PORT || 0);
const reservedApiPort = Number((process.env.E2E_RESERVED_PORTS || '').split(',')[1]);
const apiBase = `http://127.0.0.1:${pinnedApiPort || reservedApiPort}`;

test('keeps the action when the row repaints between press and release', async ({ page, request }) => {
  test.setTimeout(90000);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-dashboard-'));
  const source = path.join(dir, 'big.bin');
  const target = path.join(dir, 'out');
  await fs.mkdir(target);
  // Throttled hard enough that the transfer is still running while the press is
  // held, and long enough that the row has time to be repainted under the cursor.
  await fs.writeFile(source, Buffer.alloc(32 * 1024 * 1024));

  let jobId = '';
  try {
    const created = await request.post(`${apiBase}/api/fs/copy`, {
      data: { sources: [source], targetDir: target, throttleBps: 2 * 1024 * 1024 },
    });
    expect(created.ok()).toBe(true);
    jobId = (await created.json()).jobId;

    await page.goto(`${apiBase}/__jobs`);
    const pause = page.locator('button[data-act="pause"]').first();
    await expect(pause).toBeVisible({ timeout: 15000 });

    // Marking the row is what tells the check below a repaint happened at all: a
    // page that never redrew would keep the mark and make this case meaningless.
    // The row is marked, not the button, because the press is what pauses the job:
    // the next repaint draws Resume in that button's place.
    const row = page.locator('section.job').first();
    await row.evaluate((section) => {
      (section as HTMLElement).dataset.pressed = 'yes';
    });
    const box = await pause.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await expect(page.locator('section.job').first()).not.toHaveAttribute('data-pressed', 'yes');
    await page.mouse.up();

    const status = async () =>
      (await (await request.get(`${apiBase}/api/fs/jobs`)).json()).find((job: { id: string }) => job.id === jobId)
        ?.status;
    await expect.poll(status, { timeout: 5000 }).toBe('paused');
  } finally {
    if (jobId) await request.post(`${apiBase}/api/fs/job/${jobId}/cancel`).catch(() => undefined);
    await removeWorkspace(dir);
  }
});
