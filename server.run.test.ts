// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * Running a program is the part of the Run box that needs a second look. Three
 * things have to hold, and all are proven here on the real route:
 *
 * - nothing starts until the caller confirms; the first answer is the argv that
 *   will actually start, which is what the dialog puts in front of the user;
 * - the line is split into arguments and never handed to a shell as a string, so
 *   `&`, `|` and `>` stay words and `%TEMP%` is expanded once;
 * - a name resolves the way Windows' Run box resolves it: PATH with the usual
 *   extensions, a Start Menu label, or a file the shell owns (a batch file goes
 *   through cmd, an .msc through the shell), instead of only PATH `.exe`.
 *
 * The dry-run servers echo the argv instead of spawning, so the suite never opens
 * a window.
 */
let dry: TestServer;
let resolved: TestServer;
let root = '';

const post = async (server: TestServer, body: unknown) => {
  const response = await fetch(server.url('/api/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-run-'));
  const pathDir = path.join(root, 'bin');
  const startMenuRoot = path.join(root, 'start-menu');
  fs.mkdirSync(pathDir);
  fs.mkdirSync(startMenuRoot);
  fs.writeFileSync(path.join(pathDir, 'omni-tool.exe'), '');
  fs.writeFileSync(path.join(startMenuRoot, 'MiPrograma.lnk'), '');
  fs.writeFileSync(path.join(startMenuRoot, 'Estudio Visual.lnk'), '');
  fs.writeFileSync(path.join(root, 'script con espacios.bat'), '@echo off\r\necho hola\r\n');

  // An empty menu keeps the resolution tests about PATH and the shell: without
  // it, an entry of the machine running the suite ("Notepad") would answer first
  // now that labels win over PATH, and the expectations would move per computer.
  const emptyMenu = path.join(root, 'empty-menu');
  fs.mkdirSync(emptyMenu);
  dry = await startServer({ env: { OMNI_RUN_DRY_RUN: '1', OMNI_START_MENU_ROOTS: emptyMenu } });
  // A server whose PATH and Start Menu are the fixtures, so the resolution
  // rules are proven without depending on what this machine has installed.
  resolved = await startServer({
    env: {
      OMNI_RUN_DRY_RUN: '1',
      PATH: [pathDir, process.env.PATH].filter(Boolean).join(path.delimiter),
      OMNI_START_MENU_ROOTS: startMenuRoot,
    },
  });
}, 60000);

afterAll(async () => {
  await dry?.stop();
  await resolved?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('POST /api/run', () => {
  it('answers with the resolved argv and starts nothing until confirmed', async () => {
    const { status, body } = await post(dry, { command: 'notepad C:\\nota.txt' });
    expect(status).toBe(409);
    expect(body.error).toBe('confirmation-required');
    // The plan names the file that will run, not just the word that was typed.
    expect(body.argv[0]).toMatch(/notepad\.exe$/i);
    expect(body.argv[1]).toBe('C:\\nota.txt');
    expect(body.kind).toBeUndefined();
  });

  it('launches once the plan is confirmed', async () => {
    const { status, body } = await post(dry, { command: 'notepad C:\\nota.txt', confirmed: true });
    expect(status).toBe(200);
    expect(body.kind).toBe('launched');
    expect(body.argv[0]).toMatch(/notepad\.exe$/i);
    expect(body.argv[1]).toBe('C:\\nota.txt');
  });

  it('carries the elevation flag through the plan and the confirmed launch', async () => {
    const planned = await post(dry, { command: 'notepad C:\\nota.txt', elevated: true });
    expect(planned.status).toBe(409);
    expect(planned.body.elevated).toBe(true);
    expect(planned.body.argv[0]).toMatch(/notepad\.exe$/i);

    // The dry run stops before PowerShell is asked anything, so this proves what
    // the route was told, not that a UAC prompt was raised.
    const launched = await post(dry, { command: 'notepad C:\\nota.txt', confirmed: true, elevated: true });
    expect(launched.status).toBe(200);
    expect(launched.body.elevated).toBe(true);
    expect(launched.body.argv[1]).toBe('C:\\nota.txt');
  });

  it('does not elevate a confirmation that did not ask for it', async () => {
    const launched = await post(dry, { command: 'notepad', confirmed: true });
    expect(launched.status).toBe(200);
    expect(launched.body.elevated).toBe(false);
  });

  it('keeps a quoted path as one argument', async () => {
    const command = 'notepad "C:\\Program Files\\nota de prueba.txt"';
    const { body } = await post(dry, { command });
    expect(body.argv).toEqual([expect.stringMatching(/notepad\.exe$/i), 'C:\\Program Files\\nota de prueba.txt']);
  });

  it('treats shell operators as arguments instead of operators', async () => {
    // A shell would stop at `&` and run a second process. Here they are just
    // words, which is the whole point of not going through one.
    const { body } = await post(dry, { command: 'notepad a && notepad b | more > C:\\x.txt' });
    expect(body.argv[0]).toMatch(/notepad\.exe$/i);
    expect(body.argv.slice(1)).toEqual(['a', '&&', 'notepad', 'b', '|', 'more', '>', 'C:\\x.txt']);
  });

  it('expands environment variables once, before splitting', async () => {
    const { body } = await post(dry, { command: 'notepad %TEMP%' });
    expect(body.argv[0]).toMatch(/notepad\.exe$/i);
    expect(body.argv[1]).toBe(process.env.TEMP);
    // The variable itself must not survive into the argument.
    expect(body.argv[1]).not.toContain('%');
  });

  it('rejects an unbalanced quote instead of guessing', async () => {
    expect((await post(dry, { command: 'notepad "C:\\sin cerrar' })).status).toBe(400);
  });

  it('rejects an empty line, control characters and an absurd length', async () => {
    expect((await post(dry, { command: '   ' })).status).toBe(400);
    expect((await post(dry, { command: 'notepad\r\ncalc' })).status).toBe(400);
    expect((await post(dry, { command: 'a'.concat('b'.repeat(5000)) })).status).toBe(400);
    expect((await post(dry, { command: 42 })).status).toBe(400);
  });

  it('refuses a name the machine does not know while planning, not after confirming', async () => {
    const missing = 'omnicmd-no-such-program-3f9a';
    const planned = await post(dry, { command: missing });
    expect(planned.status).toBe(404);
    expect(planned.body.error).toBe('program-not-found');
    expect(planned.body.program).toBe(missing);

    const confirmed = await post(dry, { command: missing, confirmed: true });
    expect(confirmed.status).toBe(404);
    expect(confirmed.body.program).toBe(missing);
  });

  it('completes a bare name from PATH with its extension', async () => {
    const { status, body } = await post(resolved, { command: 'omni-tool' });
    expect(status).toBe(409);
    expect(body.argv[0]).toBe(path.join(root, 'bin', 'omni-tool.exe'));
  });

  it('runs a batch file through cmd, quoting a path with spaces', async () => {
    const script = path.join(root, 'script con espacios.bat');
    const command = `"${script}" "un argumento"`;

    const planned = await post(dry, { command });
    expect(planned.status).toBe(409);
    // CreateProcess cannot start a .bat: the plan shows the interpreter, so the
    // confirmation is honest about what will run.
    expect(planned.body.argv[0]).toBe('cmd.exe');
    expect(planned.body.argv.slice(1, 4)).toEqual(['/d', '/s', '/c']);
    expect(planned.body.argv[4]).toContain(`"${script}"`);
    expect(planned.body.argv[4]).toContain('"un argumento"');

    const launched = await post(dry, { command, confirmed: true });
    expect(launched.status).toBe(200);
    expect(launched.body.argv[4]).toBe(planned.body.argv[4]);
  });

  it('opens the Start Menu entry whose label was typed', async () => {
    const { status, body } = await post(resolved, { command: 'miprograma' });
    expect(status).toBe(409);
    expect(body.argv[0]).toBe('rundll32.exe');
    expect(body.argv.at(-1)).toBe(path.join(root, 'start-menu', 'MiPrograma.lnk'));
  });

  // "Google Chrome" is a name, not a program plus an argument: the label wins
  // over the first word, or two-word applications could never be typed.
  it('completes a label that is more than one word', async () => {
    const { status, body } = await post(resolved, { command: 'estudio visual' });
    expect(status).toBe(409);
    expect(body.target).toBe(path.join(root, 'start-menu', 'Estudio Visual.lnk'));
    expect(body.argv.at(-1)).toBe(path.join(root, 'start-menu', 'Estudio Visual.lnk'));
  });

  it('treats what follows a label as arguments, which a shortcut cannot take', async () => {
    const { status, body } = await post(resolved, { command: 'estudio visual C:\\proyecto' });
    expect(status).toBe(409);
    // The plan stays honest about what opens: the shortcut, not the folder.
    expect(body.argv[0]).toBe('rundll32.exe');
    expect(body.argv.at(-1)).toBe(path.join(root, 'start-menu', 'Estudio Visual.lnk'));
  });

  it.runIf(process.platform === 'win32')('hands a shell document like services.msc to the shell', async () => {
    const { status, body } = await post(dry, { command: 'services.msc' });
    expect(status).toBe(409);
    expect(body.argv[0]).toBe('rundll32.exe');
    expect(body.argv.at(-1)?.toLowerCase()).toMatch(/services\.msc$/);
  });
});
