import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import { BOOT_TIMEOUT_MS } from './support/boot';
import { removeWorkspace } from './support/tempWorkspaces';
import path from 'node:path';

/**
 * The quick view, driven through the interface and checked against the file.
 *
 * The pane used to paint a hex dump invented from the file name and to offer a
 * media player with a fixed 180 s duration, because the listing never carries
 * bytes on a real drive. Unit tests can prove the pane renders what it is given;
 * they cannot prove it reads the file, which is exactly what used to be missing.
 * So every case below starts at the file list, presses the shortcut a user
 * presses, and compares the pane with the bytes the test wrote itself.
 *
 * Ctrl+Q toggles the active panel's view, and the pane it opens previews the
 * focused entry of the *other* panel. Clicking a row in the right panel is
 * therefore what selects the file, and the pane appears in the left one.
 */

/** The panels address storage by drive letter, so this spec needs one to point. */
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

/** Text with accents and a trailing newline: length and bytes differ on purpose. */
const TEXT = 'vista rápida: primera línea\nsegunda línea con acentos: ñ á é\n';
/** A NUL makes this binary, so the pane must not decode it as text. */
const BINARY = [0x4f, 0x4d, 0x4e, 0x49, 0x00, 0xff];
/** Placeholder the pane shows for bytes it cannot decode as text. */
const BINARY_PLACEHOLDER = `[Contenido Binario o Sin Vista Previa - Tamaño: ${BINARY.length} bytes]`;

/** A real, playable 16-bit mono PCM WAV, so the media tab gets actual audio. */
function wavFixture(sampleCount: number): Buffer {
  const sampleRate = 8000;
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let workspace = '';
let fileSizes: Record<string, number> = {};

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-quickview-'));
  const wav = wavFixture(1600);
  await fs.writeFile(path.join(workspace, 'nota.txt'), TEXT, 'utf8');
  await fs.writeFile(path.join(workspace, 'binario.bin'), Buffer.from(BINARY));
  await fs.writeFile(path.join(workspace, 'tono.wav'), wav);
  fileSizes = {
    'nota.txt': Buffer.byteLength(TEXT),
    'binario.bin': BINARY.length,
    'tono.wav': wav.length,
  };
});

test.afterEach(async () => {
  if (workspace) await removeWorkspace(workspace);
});

/** Types an absolute path into one panel's path bar and submits it. */
async function enterPath(page: Page, panel: 0 | 1, target: string) {
  await page.locator('[data-path-bar]').nth(panel).click();
  const input = page.locator('[data-path-input]');
  await expect(input).toHaveCount(1);
  await input.fill(target);
  await input.press('Enter');
}

/** Focuses `name` in the right panel and opens the pane on it with Ctrl+Q. */
async function openQuickView(page: Page, name: string): Promise<Locator> {
  await page.goto('/');
  await enterPath(page, 1, workspace);
  const row = page.locator(`[data-name="${name}"]`);
  await expect(row).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await row.click();
  await expect(row).toHaveAttribute('data-focused', 'true');
  await page.keyboard.press('Control+q');
  const pane = page.locator('[data-quick-view]');
  await expect(pane).toBeVisible();
  return pane;
}

test('shows the characters of the focused file, not a placeholder', async ({ page }) => {
  test.setTimeout(120000);
  const pane = await openQuickView(page, 'nota.txt');

  // The name in the header is the file's own, not a label about previews.
  await expect(pane).toContainText('nota.txt');

  // Read the text out of the DOM: Playwright's text assertion collapses
  // whitespace, and the newlines are the point here.
  const pre = pane.locator('pre');
  await expect.poll(async () => pre.evaluate((el) => el.textContent)).toBe(TEXT);

  await pane.getByRole('button', { name: 'Info' }).click();
  await expect(pane).toContainText(`${fileSizes['nota.txt'].toLocaleString('en-US')} bytes`);
  await expect(pane).toContainText(path.join(workspace, 'nota.txt').replace(/\//g, '\\'));

  // The old pane printed a hex dump built from the name.
  await expect(pane).not.toContainText('_FILE_DATA');
});

test('dumps the real bytes of a binary file and says it has no text preview', async ({ page }) => {
  test.setTimeout(120000);
  const pane = await openQuickView(page, 'binario.bin');

  // NUL in the first block: the text tab must refuse to decode rather than show
  // replacement characters, and must report the size it actually read.
  await expect(pane.locator('pre')).toHaveText(BINARY_PLACEHOLDER);

  await pane.getByRole('button', { name: 'Hex' }).click();
  const hex = pane.locator('pre');
  // The bytes the test wrote: offset, hex and the ASCII column, side by side.
  await expect(hex).toContainText('00000000  4F 4D 4E 49 00 FF');
  await expect(hex).toContainText('|OMNI..|');
  // Six bytes fit in one line, so there is no second offset and no truncation
  // notice: a canned dump would have had both.
  await expect(hex).not.toContainText('00000010');
  await expect(pane).not.toContainText('Vista previa cortada');

  await expect(pane).not.toContainText('_FILE_DATA');
});

test('hands a real audio file to the browser player and reports its real size', async ({ page }) => {
  test.setTimeout(120000);
  const pane = await openQuickView(page, 'tono.wav');

  // Media is what a user wants first for a sound file, without clicking a tab.
  await expect(pane).toHaveAttribute('data-quick-view-tab', 'media');

  const audio = pane.locator('audio');
  await expect(audio).toHaveCount(1);
  // A blob of the file's own bytes: the pane does not invent a source.
  expect(await audio.getAttribute('src')).toMatch(/^blob:/);

  await pane.getByRole('button', { name: 'Info' }).click();
  await expect(pane).toContainText(`${fileSizes['tono.wav'].toLocaleString('en-US')} bytes`);

  // The removed fake player advertised a fixed 180 s duration.
  await expect(pane).not.toContainText('180');
});

test('closing the pane brings the file list back', async ({ page }) => {
  test.setTimeout(120000);
  const pane = await openQuickView(page, 'nota.txt');
  await pane.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.locator('[data-quick-view]')).toHaveCount(0);
  // The panel it replaced is a list again, with the file it was showing.
  await expect(page.locator('[data-name="nota.txt"]')).toBeVisible();
});
