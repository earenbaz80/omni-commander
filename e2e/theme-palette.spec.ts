import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT_TIMEOUT_MS } from './support/boot';
import { removeWorkspace } from './support/tempWorkspaces';
import { themes } from '../src/services/themeManager';

/**
 * The listing's glyphs are painted from the theme, and this is the case that
 * proves it in a running window.
 *
 * The unit tests around `FileTypeIcon` can show that the mapping returns the
 * right field of a `ThemeConfig`, but they cannot show that the listing hands it
 * the theme it is really using: `App.tsx` builds `themeForFileList` by spreading
 * the current theme and replacing two of its colours, so a mistake there — or a
 * component keeping a hardcoded hue — only shows up once the app runs.
 *
 * Two things are asserted. First, before any switch, the glyphs take the colours
 * of the default theme, which is what makes the second half meaningful: if the
 * icons carried their own palette, both halves would pass by accident. Second,
 * after choosing Retro Futurista in the Opciones menu, every kind of glyph is
 * drawn in the colour that the palette gives it, and none of them is pink or
 * magenta — the one thing that palette is not allowed to contain.
 */

// Pin the UI language: the menu entry driven below is the Spanish one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nc_settings_v1', JSON.stringify({ language: 'es' }));
  });
});

/**
 * Every glyph family, one file each, and the `ThemeConfig` field the palette
 * says it must be drawn in. The names are the ones the fixture writes, so the
 * rows can be found by the name the listing shows.
 */
const GLYPHS: Array<{ name: string; kind: string; field: keyof typeof themes.retro_futurist }> = [
  { name: 'carpeta', kind: 'folder', field: 'dirText' },
  { name: 'informe.pdf', kind: 'document', field: 'docText' },
  { name: 'notas.txt', kind: 'document', field: 'docText' },
  { name: 'programa.exe', kind: 'exec', field: 'exeText' },
  { name: 'datos.zip', kind: 'archive', field: 'zipText' },
  { name: 'disco.iso', kind: 'disk', field: 'zipText' },
  { name: 'codigo.ts', kind: 'code', field: 'accent' },
  { name: 'foto.png', kind: 'image', field: 'mediaText' },
  { name: 'tono.mp3', kind: 'audio', field: 'mediaText' },
  { name: 'video.mp4', kind: 'video', field: 'mediaText' },
  { name: 'misterio.xyz', kind: 'file', field: 'itemText' },
];

/**
 * High red over high blue with almost no green: magenta, and its pale pink
 * cousin. Amber, teal, sand and terracotta all stay clear of it.
 */
function isPinkish(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 200 && b > 160 && g < 140;
}

let workspace = '';

test.beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-theme-'));
  await fs.mkdir(path.join(workspace, 'carpeta'));
  // One file per family; the bytes are irrelevant, the extension is not.
  for (const { name } of GLYPHS) {
    if (name === 'carpeta') continue;
    await fs.writeFile(path.join(workspace, name), `fixture for ${name}\n`, 'utf8');
  }
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

/** Chooses one entry of the Opciones menu, which is where the themes live. */
async function chooseTheme(page: Page, label: RegExp) {
  const menu = page.getByRole('button', { name: 'Opciones', exact: true });
  await menu.click();
  await menu.locator('..').getByRole('button', { name: label }).click();
}

/** The glyph a row is drawn with, addressed by the name the listing shows. */
function glyphOf(page: Page, name: string) {
  return page.locator(`[data-name="${name}"] svg[data-file-icon]`);
}

test('the listing draws its glyphs in the colours of the active theme', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await enterPath(page, 1, workspace);
  await expect(page.locator('[data-name="misterio.xyz"]')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });

  // The default theme is the DOS blue one. If this half failed, the second half
  // would prove nothing: the glyphs would be showing a palette of their own.
  const defaultTheme = themes.classic_blue;
  for (const { name, field } of GLYPHS) {
    await expect(glyphOf(page, name), `${name} ignores the default palette`).toHaveAttribute(
      'stroke',
      defaultTheme[field] as string,
    );
  }

  await chooseTheme(page, /^Retro Futurista/);

  // The choice has to reach the settings, not just repaint this render.
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nc_settings_v1') || '{}').value?.theme))
    .toBe('retro_futurist');

  const palette = themes.retro_futurist;
  for (const { name, kind, field } of GLYPHS) {
    const glyph = glyphOf(page, name);
    await expect(glyph, `${name} is drawn with the wrong glyph`).toHaveAttribute('data-file-icon', kind);
    await expect(glyph, `${name} is drawn outside the palette`).toHaveAttribute('stroke', palette[field] as string);
  }

  // The folder body is filled with its own outline colour rather than a second
  // hue, which is what keeps the set to one ink per kind.
  const folderFill = page.locator('[data-name="carpeta"] svg[data-file-icon] path[fill]').first();
  await expect(folderFill).toHaveAttribute('fill', palette.dirText);

  // And the rule the palette exists to keep: nothing warm-leaning went pink.
  const strokes: string[] = await page
    .locator('svg[data-file-icon]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('stroke') || ''));
  expect(strokes.length).toBeGreaterThan(GLYPHS.length);
  expect(strokes.filter(isPinkish), 'a glyph is pink or magenta').toEqual([]);
});
