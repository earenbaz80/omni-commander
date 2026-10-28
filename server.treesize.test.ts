// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * GET /api/treesize exists because the renderer used to build this tree from its
 * own listing index: only folders the user had already opened were in it, so
 * every other folder reported 0 bytes and the report was useless. These tests
 * pin the whole point of the endpoint — the numbers have to be measured, added
 * up per folder and ordered, not read from a cache.
 */
let server: TestServer;
let root = '';
/** A folder outside the measured root, so its size does not change the totals. */
let bulk = '';
let driveId = '';
let driveLetter = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const writeFile = (relative: string, bytes: number) => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes, 'x'));
};

/**
 * The endpoint answers a newline-delimited stream: progress, each finished root
 * folder and finally the tree. This collects the whole stream so a test can
 * assert both the messages and the answer.
 */
const treeSize = async (path_: string, drive = driveId) => {
  const response = await fetch(
    server.url(`/api/treesize?driveId=${encodeURIComponent(drive)}&path=${encodeURIComponent(path_)}`),
  );
  if (!response.ok) return { status: response.status, body: await response.json().catch(() => null), messages: [] };

  const text = await response.text();
  const messages = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const answer = messages.find((message) => message.type === 'done');
  return { status: response.status, body: answer ? answer.tree : null, messages };
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tree-'));
  writeFile('informe.txt', 100);
  writeFile('video.bin', 400);
  writeFile(path.join('proyectos', 'nota.txt'), 50);
  writeFile(path.join('proyectos', 'anidado', 'dato.txt'), 25);
  writeFile(path.join('otros', 'pequeno.txt'), 10);

  bulk = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tree-bulk-'));
  for (let i = 0; i < 1500; i++) fs.writeFileSync(path.join(bulk, `f${i}.txt`), 'x');

  driveLetter = `${path.parse(root).root.charAt(0).toUpperCase()}:`;
  driveId = `real_${driveLetter.charAt(0)}`;

  server = await startServer({ env: { OMNI_SESSION_TOKEN: '' } });
}, 40000);

afterAll(async () => {
  await server.stop();
  for (const folder of [root, bulk]) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        /* still closing */
      }
      if (!fs.existsSync(folder)) break;
      await sleep(150);
    }
  }
}, 20000);

describe('GET /api/treesize', () => {
  it('adds up every file under the folder, including unopened subfolders', async () => {
    const { status, body } = await treeSize(root);

    expect(status).toBe(200);
    // 100 + 400 at the root, 50 + 25 in proyectos, 10 in otros.
    expect(body.sizeBytes).toBe(585);
    expect(body.fileCount).toBe(5);
    // proyectos, proyectos/anidado and otros.
    expect(body.dirCount).toBe(3);
    expect(body.truncated).toBe(false);
  });

  it('orders subfolders biggest first and keeps the parent total equal to their sum', async () => {
    const { body } = await treeSize(root);

    expect(body.subFolders.map((folder: { name: string }) => folder.name)).toEqual(['proyectos', 'otros']);
    const [proyectos, otros] = body.subFolders;
    expect(proyectos.sizeBytes).toBe(75);
    expect(proyectos.fileCount).toBe(2);
    expect(proyectos.dirCount).toBe(1);
    expect(otros.sizeBytes).toBe(10);
    expect(proyectos.sizeBytes + otros.sizeBytes).toBeLessThan(body.sizeBytes);
  });

  it('reports the largest files it found, biggest first', async () => {
    const { body } = await treeSize(root);

    expect(body.topFiles[0]).toMatchObject({ fullName: 'video.bin', size: 400 });
    expect(body.topFiles.map((file: { fullName: string }) => file.fullName)).toEqual([
      'video.bin',
      'informe.txt',
      'nota.txt',
      'dato.txt',
      'pequeno.txt',
    ]);
  });

  it('measures a subfolder on its own when the panel is pointing at it', async () => {
    const { status, body } = await treeSize(path.join(root, 'proyectos'));

    expect(status).toBe(200);
    expect(body.name).toBe('proyectos');
    expect(body.sizeBytes).toBe(75);
    expect(body.subFolders.map((folder: { name: string }) => folder.name)).toEqual(['anidado']);
  });

  it('reports progress and finished root folders before the final tree', async () => {
    const { messages } = await treeSize(root);

    const progress = messages.filter((message: { type: string }) => message.type === 'progress');
    const finished = messages.filter((message: { type: string }) => message.type === 'folder');

    expect(progress.length).toBeGreaterThan(0);
    // Both root folders are announced by name while the answer is still open.
    expect(finished.map((message: { folder: { name: string } }) => message.folder.name).sort()).toEqual([
      'otros',
      'proyectos',
    ]);
    // The answer always comes last: a client that stops reading has no tree.
    expect(messages[messages.length - 1].type).toBe('done');
  });

  // 1.500 freshly written files: the walk is bound by the disk, not by the
  // assertions, and the 5 s default leaves no room on a loaded machine. The
  // file's other tests measure a handful of entries and keep the default.
  it('measures a folder larger than any fixed entry budget to the last file', async () => {
    const { status, body } = await treeSize(bulk);

    expect(status).toBe(200);
    expect(body.fileCount).toBe(1500);
    expect(body.sizeBytes).toBe(1500);
    expect(body.truncated).toBe(false);
  }, 20000);

  it('keeps refusing a folder that is not there, an unknown drive and a path outside it', async () => {
    const missing = await treeSize(path.join(root, 'no-existe'));
    const unknown = await treeSize(root, 'real_ZZZ');
    const outside = await treeSize(`${driveLetter}\\Windows`, 'real_ZZZ');

    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain('Folder not found');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('Unknown drive');
    expect(outside.status).toBe(400);
  });
});
