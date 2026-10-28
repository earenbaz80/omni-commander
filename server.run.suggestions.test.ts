// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The autocomplete has to answer with things that will actually work when the
 * line is submitted, so the suite checks two claims:
 *
 * - a program is offered as its Start Menu shortcut path (something the opener
 *   can act on), never as a bare name that only works if PATH happens to agree;
 * - the destinations Windows answers to by name are offered as themselves.
 *
 * The Start Menu of the machine running the suite is not part of the test:
 * OMNI_START_MENU_ROOTS points the scan at a scratch tree built here, so the
 * expectations do not depend on which programs this computer has installed.
 */
let server: TestServer;
let root = '';

const ask = async (q: string, target: TestServer = server) => {
  const response = await fetch(target.url(`/api/run/suggestions?q=${encodeURIComponent(q)}`));
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-suggest-'));
  const menu = path.join(root, 'Programs');
  const tools = path.join(menu, 'Herramientas');
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(menu, 'Notepad++.lnk'), '');
  fs.writeFileSync(path.join(tools, 'Editor de fotos.lnk'), '');
  fs.writeFileSync(path.join(tools, 'Desinstalar Editor de fotos.lnk'), '');
  fs.writeFileSync(path.join(menu, 'Musica.lnk'), '');
  fs.writeFileSync(path.join(menu, 'notas.txt'), '');

  server = await startServer({ env: { OMNI_START_MENU_ROOTS: menu } });
}, 30000);

afterAll(async () => {
  await server?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('GET /api/run/suggestions', () => {
  it('answers nothing for an empty query instead of dumping the whole machine', async () => {
    expect((await ask('')).body.suggestions).toEqual([]);
    expect((await ask('   ')).body.suggestions).toEqual([]);
  });

  it('offers a Start Menu program as the shortcut path it can actually open', async () => {
    const { status, body } = await ask('notepad');
    expect(status).toBe(200);
    const hit = body.suggestions.find((entry: any) => entry.label === 'Notepad++');
    expect(hit).toBeDefined();
    expect(hit.kind).toBe('app');
    expect(hit.value.toLowerCase()).toBe(path.join(root, 'Programs', 'Notepad++.lnk').toLowerCase());
  });

  it('finds a program by a word in the middle of its name', async () => {
    const { body } = await ask('fotos');
    expect(body.suggestions.map((entry: any) => entry.label)).toContain('Editor de fotos');
  });

  it('ignores uninstall shortcuts and files that are not shortcuts', async () => {
    const { body } = await ask('editor');
    const labels = body.suggestions.map((entry: any) => entry.label);
    expect(labels).toContain('Editor de fotos');
    expect(labels.some((label: string) => /desinstalar/i.test(label))).toBe(false);
    expect(labels).not.toContain('notas');
  });

  it('matches without caring about case or accents', async () => {
    const { body } = await ask('MÚSICA');
    expect(body.suggestions.map((entry: any) => entry.label)).toContain('Musica');
  });

  it('offers the destinations Windows answers to by name', async () => {
    const settings = await ask('ms-settings:disp');
    expect(settings.body.suggestions[0]).toEqual({ value: 'ms-settings:display', kind: 'system' });

    const services = await ask('serv');
    expect(services.body.suggestions.map((entry: any) => entry.value)).toContain('services.msc');
  });

  it('prefers names that start with the query over ones that merely contain it', async () => {
    const { body } = await ask('calc');
    expect(body.body).toBeUndefined();
    expect(body.suggestions[0].value).toBe('calc');
  });

  it('caps the answer so the list stays a list', async () => {
    const { body } = await ask('e');
    expect(body.suggestions.length).toBeLessThanOrEqual(8);
  });

  it('rejects an absurd query rather than scanning for it', async () => {
    expect((await ask('x'.repeat(200))).status).toBe(400);
  });
});
