// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, WINDOWS_PROCESS_CASE_TIMEOUT_MS, type TestServer } from '@/scripts/serverHarness';

/**
 * "Enviar a" writes on the user's real disk, and the rule that matters is the
 * one the menu promises: the desktop gets a shortcut, every other destination
 * gets a copy of the item.
 *
 * - a .lnk is only proven by reading the target back out of the shortcut;
 * - a copy must exist with the same bytes and must not be a shortcut;
 * - an unknown destination, a missing item or a relative folder are refused
 *   instead of writing somewhere unasked.
 *
 * The suite points every destination at a scratch folder through
 * OMNI_SEND_TO_ROOT, because the alternative is littering the real desktop.
 */
let server: TestServer;
let root = '';
let targetFile = '';
let targetFolder = '';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const post = async (route: string, body: unknown) => {
  const response = await fetch(server.url(`/api/fs/${route}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

/** Reads the target a .lnk really points at, which is the only real proof. */
const shortcutTarget = async (lnkPath: string): Promise<string> => {
  const encoded = Buffer.from(lnkPath, 'utf8').toString('base64');
  const command =
    `$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
    `(New-Object -ComObject WScript.Shell).CreateShortcut($p).TargetPath`;
  const { stdout } = await execFileAsync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ]);
  return String(stdout || '').trim();
};

/**
 * Windows stores whichever spelling of a path it was given, so the scratch
 * temp folder can come back as its 8.3 short name (EDELAR~1). Comparing the
 * real paths keeps the assertion about the target, not about spelling.
 */
const canonical = (value: string) => fs.realpathSync.native(value).toLowerCase();

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-sendto-'));
  const origin = path.join(root, 'origen');
  fs.mkdirSync(origin);
  targetFile = path.join(origin, 'informe.txt');
  fs.writeFileSync(targetFile, 'contenido');
  targetFolder = path.join(origin, 'proyectos');
  fs.mkdirSync(targetFolder);

  server = await startServer({
    env: { OMNI_SESSION_TOKEN: '', OMNI_SEND_TO_ROOT: root },
  });
}, 40000);

afterAll(async () => {
  await server.stop();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* still closing */
    }
    if (!fs.existsSync(root)) return;
    await sleep(150);
  }
}, 20000);

describe('POST /api/fs/sendto', () => {
  // These two are the only cases here that pay for two PowerShell processes each:
  // the server runs one to write the .lnk (COM, WScript.Shell) and the test runs
  // another to read its target back. That is a spawn, not an assertion, so they
  // take the harness's Windows-process budget instead of a limit of their own.
  it(
    'puts a shortcut on the desktop that points at the item',
    async () => {
      const { status, body } = await post('sendto', { path: targetFile, destination: 'desktop' });

      expect(status).toBe(200);
      expect(body.kind).toBe('shortcut');
      expect(path.basename(body.path)).toBe('informe.txt - Acceso directo.lnk');
      expect(canonical(await shortcutTarget(body.path))).toBe(canonical(targetFile));
    },
    WINDOWS_PROCESS_CASE_TIMEOUT_MS,
  );

  it(
    'numbers a second desktop shortcut instead of replacing the first',
    async () => {
      const { status, body } = await post('sendto', { path: targetFile, destination: 'desktop' });

      expect(status).toBe(200);
      expect(path.basename(body.path)).toBe('informe.txt - Acceso directo (2).lnk');
      expect(canonical(await shortcutTarget(body.path))).toBe(canonical(targetFile));
    },
    WINDOWS_PROCESS_CASE_TIMEOUT_MS,
  );

  it('copies the item to documents instead of shortcutting it', async () => {
    const { status, body } = await post('sendto', { path: targetFile, destination: 'documents' });

    expect(status).toBe(200);
    expect(body.kind).toBe('copy');
    expect(body.path).toBe(path.join(root, 'informe.txt'));
    expect(fs.readFileSync(body.path, 'utf8')).toBe('contenido');
  });

  it('copies a folder to the picked destination', async () => {
    const picked = path.join(root, 'elegida');
    fs.mkdirSync(picked);
    const { status, body } = await post('sendto', { path: targetFolder, destinationDir: picked });

    expect(status).toBe(200);
    expect(body.kind).toBe('copy');
    expect(body.path).toBe(path.join(picked, 'proyectos'));
    expect(fs.statSync(body.path).isDirectory()).toBe(true);
  });

  it('refuses a destination it does not know', async () => {
    const { status, body } = await post('sendto', { path: targetFile, destination: 'C:\\' });

    expect(status).toBe(400);
    expect(body.error).toContain('Unknown destination');
  });

  it('refuses a destination folder that is not absolute', async () => {
    const { status, body } = await post('sendto', { path: targetFile, destinationDir: 'Desktop' });

    expect(status).toBe(400);
    expect(body.error).toContain('Unsafe path');
  });

  it('reports a missing item instead of copying nothing', async () => {
    const { status, body } = await post('sendto', {
      path: path.join(root, 'no-existe.txt'),
      destination: 'desktop',
    });

    expect(status).toBe(404);
    expect(body.error).toContain('no longer exists');
  });
});
