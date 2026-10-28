// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The Run dialog opens what Windows would open, and refuses everything else.
 *
 * The suite runs the server with OMNI_RUN_DRY_RUN=1, so the route returns the
 * argv it *would* hand to rundll32 instead of opening windows on the desktop.
 * That is what makes the assertions meaningful: they check the real target that
 * reached the shell, not just that some code path was taken.
 *
 * The refusal cases matter as much as the happy ones. `cmd /c ...` must not
 * become a command interpreter here, and a UNC path must not turn a loopback,
 * offline file manager into an SMB client.
 */
let server: TestServer;
let resolved: TestServer;
let root = '';
let folder = '';
let file = '';

const post = async (target: unknown) => {
  const response = await fetch(server.url('/api/open'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-open-'));
  folder = path.join(root, 'carpeta');
  fs.mkdirSync(folder);
  file = path.join(root, 'nota.txt');
  fs.writeFileSync(file, 'hola');
  const startMenu = path.join(root, 'start-menu');
  fs.mkdirSync(startMenu);
  fs.writeFileSync(path.join(startMenu, 'MiPrograma.lnk'), '');
  fs.writeFileSync(path.join(startMenu, 'Chrome Beta.lnk'), '');

  // The first server sees an empty menu: a label installed on this computer
  // ("Notepad") would otherwise open here and turn "refuses bare commands" into
  // a test of whatever happens to be installed on the machine running it.
  const emptyMenu = path.join(root, 'empty-menu');
  fs.mkdirSync(emptyMenu);
  server = await startServer({ env: { OMNI_RUN_DRY_RUN: '1', OMNI_START_MENU_ROOTS: emptyMenu } });
  // A second server whose Start Menu is the fixture, so a typed label is proven
  // without depending on what this machine has installed.
  resolved = await startServer({
    env: { OMNI_RUN_DRY_RUN: '1', OMNI_START_MENU_ROOTS: startMenu },
  });
}, 40000);

afterAll(async () => {
  await server?.stop();
  await resolved?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('POST /api/open', () => {
  it('reports an existing folder so the panel navigates instead of opening Explorer', async () => {
    const { status, body } = await post(folder);
    expect(status).toBe(200);
    expect(body.kind).toBe('folder');
    expect(body.path).toBe(folder);
    // A folder must not also be launched: that would be two answers to one key.
    expect(body.launched).toBeUndefined();
  });

  it('opens an existing file with its default program', async () => {
    const { status, body } = await post(file);
    expect(status).toBe(200);
    expect(body.kind).toBe('opened');
    expect(body.path).toBe(file);
    expect(body.launched[0]).toBe('rundll32.exe');
    expect(body.launched.at(-1)).toBe(file);
  });

  it('accepts a quoted path, which is how the Run box takes spaces', async () => {
    const { status, body } = await post(`"${folder}"`);
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'folder', path: folder });
  });

  it('expands environment variables like the Run box does', async () => {
    const { status, body } = await post('%TEMP%');
    expect(status).toBe(200);
    expect(body.kind).toBe('folder');
    expect(body.path.toLowerCase()).toContain('temp');
  });

  it('hands system destinations to the shell untouched', async () => {
    for (const target of ['ms-settings:display', 'shell:startup', 'https://example.com/']) {
      const { status, body } = await post(target);
      expect(status, target).toBe(200);
      expect(body.kind).toBe('opened');
      expect(body.launched.at(-1)).toBe(target);
    }
  });

  it('reports a path that does not exist instead of launching it', async () => {
    const missing = path.join(root, 'no-existe');
    const { status, body } = await post(missing);
    expect(status).toBe(404);
    expect(body.error).toBe('not-found');
    expect(body.launched).toBeUndefined();
  });

  it('opens the Start Menu entry whose label was typed', async () => {
    const response = await fetch(resolved.url('/api/open'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'miprograma' }),
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.kind).toBe('opened');
    expect(body.target).toBe(path.join(root, 'start-menu', 'MiPrograma.lnk'));
    expect(body.launched[0]).toBe('rundll32.exe');
  });

  it('opens a label made of more than one word, spaces included', async () => {
    const response = await fetch(resolved.url('/api/open'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'chrome beta' }),
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.target).toBe(path.join(root, 'start-menu', 'Chrome Beta.lnk'));
    expect(body.launched.at(-1)).toBe(path.join(root, 'start-menu', 'Chrome Beta.lnk'));
  });

  it.runIf(process.platform === 'win32')('opens a shell document typed by name, like services.msc', async () => {
    const { status, body } = await post('services.msc');
    expect(status).toBe(200);
    expect(body.kind).toBe('opened');
    expect(body.target.toLowerCase()).toMatch(/services\.msc$/);
    expect(body.launched[0]).toBe('rundll32.exe');
  });

  it('refuses bare commands: this is a launcher, not a shell', async () => {
    for (const target of ['notepad', 'cmd /c calc', 'powershell -Command Get-Process']) {
      const { status, body } = await post(target);
      expect(status, target).toBe(422);
      expect(body.error).toBe('unsupported-target');
      expect(body.launched).toBeUndefined();
    }
  });

  it('opens a web address typed without its scheme, like the Run box does', async () => {
    for (const [typed, opened] of [
      ['google.com', 'http://google.com'],
      ['www.example.org/guia?q=1', 'http://www.example.org/guia?q=1'],
      ['localhost:3000', 'http://localhost:3000'],
    ]) {
      const { status, body } = await post(typed);
      expect(status, typed).toBe(200);
      expect(body.kind).toBe('opened');
      expect(body.target).toBe(opened);
      // The browser is handed a real http URL, not the bare words.
      expect(body.launched.at(-1)).toBe(opened);
    }
  });

  it('does not mistake a file name for a web address', async () => {
    // These are documents, not hosts: sending them to a browser would open a
    // page about nothing instead of saying the file is not there.
    for (const target of ['notas.txt', 'informe.docx', 'datos.json', 'C:notas.txt']) {
      const { status, body } = await post(target);
      expect(status, target).toBe(422);
      expect(body.launched).toBeUndefined();
    }
  });

  it('refuses unknown URI schemes', async () => {
    const { status, body } = await post('vscode://file/C:/');
    expect(status).toBe(422);
    expect(body.error).toBe('unsupported-target');
  });

  it('refuses network paths so the offline app never reaches SMB', async () => {
    const { status, body } = await post('\\\\servidor\\recurso');
    expect(status).toBe(422);
    expect(body.launched).toBeUndefined();
  });

  it('rejects control characters instead of passing a second line to the shell', async () => {
    const { status, body } = await post('ms-settings:display\r\ncalc');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid-target');
    expect(body.launched).toBeUndefined();
  });

  it('rejects an empty or absurdly long target', async () => {
    expect((await post('   ')).status).toBe(400);
    expect((await post('C:'.concat('a'.repeat(3000)))).status).toBe(400);
    expect((await post(42)).status).toBe(400);
  });
});
