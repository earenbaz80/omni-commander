import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { BOOT_TIMEOUT_MS } from './support/boot';
import { ipconfigProblems, processTableProblems, treeProblems } from './support/commandOutput';
import { removeWorkspace } from './support/tempWorkspaces';

/**
 * The command bar, driven through the interface and checked against the machine.
 *
 * `ipconfig`, `tasklist` and `tree` used to answer from the translation tables:
 * a fixed 192.168.1.150 adapter, a four-row process table and four invented
 * folder names. They now read the server, which reads the OS — and the only way
 * to catch a regression back to canned text is to compare the rendered output
 * with what this process can see for itself. A test that called the engine would
 * prove the bridge works and nothing about what the shell shows.
 *
 * So each case below pins the answer to an independent observation: the printed
 * addresses must belong to `os.networkInterfaces()`, the PIDs must match a
 * `tasklist` run by the test itself, and the tree must contain folders created
 * in a temp directory, nested where they were created.
 */

const execFileAsync = promisify(execFile);

/**
 * The panels address storage by drive letter and `tree` walks the panel's own
 * drive, so this spec has nothing to drive where paths start with `/`.
 */
const driveRoot = path.parse(os.tmpdir()).root;
const hasDriveLetters = /^[A-Za-z]:[\\/]/.test(driveRoot);

test.skip(
  !hasDriveLetters,
  `the interface addresses paths by drive letter, but this platform's root is "${driveRoot}"`,
);

// Pin the UI language so the labels read below don't move with the default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

/** Types an absolute path into one panel's path bar and submits it. */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  await page.locator('[data-path-bar]').nth(panel).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(target);
  await input.press('Enter');
}

/** Opens the output drawer, which starts closed and is where output is shown. */
async function openConsole(page: Page) {
  await page.getByTitle('Ver / Ocultar consola de salida').click();
  await expect(page.locator('[data-command-log]')).toBeVisible();
}

/**
 * Runs one command and returns the output the app rendered for it. The drawer
 * gains one `<pre>` per command once the read finishes, so waiting for the count
 * to grow is waiting for the real answer rather than for a fixed delay.
 */
async function runCommand(page: Page, command: string): Promise<Locator> {
  const outputs = page.locator('[data-command-log] pre');
  const before = await outputs.count();

  const input = page.locator('input[placeholder*="Escriba un comando"]');
  await input.click();
  await input.fill(command);
  await input.press('Enter');

  // The app itself allows a read 210 s (the server gives a process listing 180 s
  // and the client adds a margin), so the spec waits the same. Waiting less than
  // the app would turn a slow but healthy machine into a red test: tasklist was
  // measured at 38 s idle and past two minutes with the rest of the suite beside
  // it, which is exactly what a 120 s wait here used to report as a failure.
  await expect(outputs).toHaveCount(before + 1, { timeout: 210000 });
  const output = outputs.last();
  await expect(output).toHaveText(/\S/, { timeout: 210000 });
  return output;
}

/** Every IPv4 address and mask this process can see, as the server reads them. */
function localInterfaces() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => String(entry.family) === 'IPv4');
}

test('ipconfig prints only addresses this machine has', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await openConsole(page);

  const output = await runCommand(page, 'ipconfig');
  const text = await output.innerText();

  const interfaces = localInterfaces();
  // Without an adapter the check below would pass on an empty output, so the
  // machine has to have one before the check means anything.
  expect(interfaces.length).toBeGreaterThan(0);

  // A canned address cannot pass this: the shell may only print what is on this
  // machine, and the old fixed table would fail on every other host.
  const problems = ipconfigProblems(
    text,
    interfaces.map((entry) => ({ address: entry.address, netmask: entry.netmask })),
  );
  expect(problems, problems.join('\n')).toEqual([]);
});

test('tasklist lists processes this machine is running', async ({ page }) => {
  test.setTimeout(300000);
  await page.goto('/');
  await openConsole(page);

  const output = await runCommand(page, 'tasklist');
  const text = await output.innerText();

  // Independent listing: the PIDs the shell shows must be PIDs this process can
  // also see. A few may exit between the two reads, which is why the check asks
  // for a floor rather than an exact match.
  const { stdout } = await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const observedPids = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.split('","');
    if (fields.length < 2) continue;
    const pid = fields[1].replace(/\D/g, '');
    if (pid) observedPids.add(pid);
  }

  const problems = processTableProblems(text, observedPids);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('tree lists the folders the active panel is really showing', async ({ page }) => {
  test.setTimeout(180000);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-tree-'));
  try {
    // Two levels under one branch and a sibling folder, so depth and order can
    // be checked against a layout this test wrote itself.
    await fs.mkdir(path.join(workspace, 'alfa', 'beta'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'gamma'));
    await fs.writeFile(path.join(workspace, 'nota.txt'), 'hola\n');

    await page.goto('/');

    const drive = path.parse(workspace).root.replace(/[\\/]/g, '');
    const driveButtons = page.getByRole('button', { name: `[${drive}]` });
    await expect(driveButtons.first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
    await driveButtons.first().click();
    await enterPath(page, 0, workspace);

    // Clicking inside a panel makes it the active one, and `tree` reads that
    // panel's folder. Selecting a real row does it without reopening the editor.
    await page.locator('[data-name="gamma"]').click();
    await expect(page.locator('[data-name="alfa"]')).toBeVisible({ timeout: 30000 });

    await openConsole(page);
    const output = await runCommand(page, 'tree');
    const text = await output.innerText();

    // The tree starts at the folder the panel is in, `beta` sits under `alfa`,
    // files are not folders, and the invented names are gone for good.
    const problems = treeProblems(text, {
      root: workspace,
      folders: ['alfa', 'beta', 'gamma'],
      nested: { beta: 'alfa' },
      forbidden: ['nota.txt', 'OMNICMD', 'Administrator'],
    });
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await removeWorkspace(workspace);
  }
});
