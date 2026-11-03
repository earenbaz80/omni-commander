// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * "Open with" is the shell's chooser, not a launcher of ours: the file goes to
 * rundll32, Windows decides which programs to offer, and the user chooses.
 *
 * The suite runs the server with OMNI_RUN_DRY_RUN=1, so the route reports the
 * argv it would hand to rundll32 instead of opening a dialog on the desktop of
 * whoever runs the tests. The refusals matter as much as the happy path: the
 * dialog must never be asked for an empty path, a folder, or a path that the
 * drive safety check rejects.
 *
 * The picker is modal and lives until the user picks, which is why the route
 * answers as soon as the launcher starts rather than waiting for it to exit.
 */
let server: TestServer;
let root = '';
let file = '';
let folder = '';

const post = async (body: unknown) => {
  const response = await fetch(server.url('/api/open-with'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-openwith-'));
  folder = path.join(root, 'carpeta');
  fs.mkdirSync(folder);
  file = path.join(root, 'nota.txt');
  fs.writeFileSync(file, 'hola');

  server = await startServer({ env: { OMNI_RUN_DRY_RUN: '1' } });
}, 40000);

afterAll(async () => {
  await server?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('POST /api/open-with', () => {
  it('hands a real file to the shell picker', async () => {
    const { status, body } = await post({ path: file });
    expect(status).toBe(200);
    expect(body.path).toBe(file);
    expect(body.launched).toEqual(['rundll32.exe', 'shell32.dll,OpenAs_RunDLL', file]);
  });

  it('keeps a path with spaces as one argument', async () => {
    const spaced = path.join(root, 'mi nota final.txt');
    fs.writeFileSync(spaced, 'hola');
    const { status, body } = await post({ path: spaced });
    expect(status).toBe(200);
    // The whole path is one argv element, so nothing after the space is lost.
    expect(body.launched).toEqual(['rundll32.exe', 'shell32.dll,OpenAs_RunDLL', spaced]);
  });

  it('refuses an empty path', async () => {
    expect((await post({ path: '   ' })).body.error).toBe('empty-path');
    expect((await post({})).status).toBe(400);
  });

  it('refuses a folder, which the shell would open instead of asking', async () => {
    const { status, body } = await post({ path: folder });
    expect(status).toBe(400);
    expect(body.error).toBe('not-a-file');
  });

  it('reports a file that is no longer there', async () => {
    const { status, body } = await post({ path: path.join(root, 'fantasma.bin') });
    expect(status).toBe(404);
    expect(body.error).toBe('not-found');
  });

  it('refuses a path the drive safety check rejects', async () => {
    const { status, body } = await post({ path: '\\\\servidor-remoto\\recurso\\nota.txt' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid-path');
  });
});

/**
 * The submenu's own two routes. Windows will not raise the shell's chooser above
 * the app when the process that asked for it is not in the foreground, so the
 * menu has to be able to list and start the registered programs itself.
 */
describe('GET /api/open-with/programs', () => {
  const get = async (target: string) => {
    const response = await fetch(server.url(`/api/open-with/programs?path=${encodeURIComponent(target)}`));
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };

  it('answers with a list the menu can render', async () => {
    const { status, body } = await get(file);
    expect(status).toBe(200);
    expect(body.path).toBe(file);
    // The registry read is skipped under the dry-run switch, so the shape is what
    // this asserts: the menu renders the same either way.
    expect(Array.isArray(body.programs)).toBe(true);
  });

  it('refuses a folder, a missing file and a rejected path', async () => {
    expect((await get(folder)).body.error).toBe('not-a-file');
    expect((await get(path.join(root, 'fantasma.bin'))).status).toBe(404);
    expect((await get('\\\\servidor-remoto\\recurso\\nota.txt')).body.error).toBe('invalid-path');
  });
});

describe('POST /api/open-with/app', () => {
  // A real executable on the machine, so the check that it exists is honest.
  const program = process.execPath;

  const postApp = async (body: unknown) => {
    const response = await fetch(server.url('/api/open-with/app'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };

  it('runs the chosen program with the file as its own argument', async () => {
    const { status, body } = await postApp({ path: file, program });
    expect(status).toBe(200);
    expect(body.program).toBe(program);
    expect(body.launched).toEqual([program, file]);
  });

  it('refuses a program that is not an absolute executable on disk', async () => {
    expect((await postApp({ path: file, program: 'bloc-de-notas.exe' })).body.error).toBe('invalid-program');
    expect((await postApp({ path: file, program: path.join(root, 'nota.txt') })).body.error).toBe('invalid-program');
    expect((await postApp({ path: file, program: path.join(root, 'no-existe.exe') })).body.error).toBe(
      'invalid-program',
    );
    expect((await postApp({ path: file })).body.error).toBe('invalid-program');
  });

  it('refuses a folder and a path the safety check rejects', async () => {
    expect((await postApp({ path: folder, program })).body.error).toBe('not-a-file');
    expect((await postApp({ path: '\\\\servidor-remoto\\recurso\\nota.txt', program })).body.error).toBe(
      'invalid-path',
    );
    expect((await postApp({ path: path.join(root, 'fantasma.bin'), program })).status).toBe(404);
  });
});
