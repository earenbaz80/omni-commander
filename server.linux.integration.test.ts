// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The Linux CI job boots the real server instead of importing the route
 * modules, because the port's remaining risk is exactly the seam between the
 * POSIX path policy and the code that was written around Windows drive paths.
 *
 * A temporary workspace holds every fixture, and the server's data, scratch,
 * logs and trash roots are redirected into it, so a run leaves nothing behind.
 */
interface Drive {
  id: string;
  letter: string;
}

interface JobSnapshot {
  status?: string;
  errors?: { message: string }[];
}

let server: TestServer;
let root = '';
let driveId = '';
let workspace = '';
let treeRoot = '';
let destination = '';
let moved = '';
let extracted = '';
let zipPath = '';
let trashSource = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(route: string, init?: RequestInit) {
  const response = await fetch(server.url(route), init);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const get = (route: string) => request(route);

const post = (route: string, body: unknown) =>
  request(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

function driveFor(target: string, drives: Drive[]): Drive {
  const matching = drives
    .filter((drive) => {
      const prefix = drive.letter.endsWith('/') ? drive.letter : `${drive.letter}/`;
      return target === drive.letter || target.startsWith(prefix);
    })
    .sort((left, right) => right.letter.length - left.letter.length);
  if (!matching[0]) throw new Error(`No drive contains ${target}`);
  return matching[0];
}

async function waitForJob(jobId: string): Promise<JobSnapshot> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const { body } = await get(`/api/fs/job/${encodeURIComponent(jobId)}`);
    const job = body as JobSnapshot | null;
    if (job?.status === 'done') return job;
    if (job?.status === 'done-with-errors' || job?.status === 'cancelled') {
      throw new Error(`Job ${jobId} ended as ${job.status}: ${JSON.stringify(job.errors || [])}`);
    }
    await sleep(50);
  }
  throw new Error(`Job ${jobId} did not finish in time`);
}

beforeAll(async () => {
  // The suite is skipped elsewhere, but a top-level hook still runs: leave the
  // Windows suite without a server process or a drive to resolve.
  if (process.platform !== 'linux') return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-linux-ci-'));
  workspace = path.join(root, 'workspace');
  treeRoot = path.join(workspace, 'tree');
  destination = path.join(root, 'destination');
  moved = path.join(root, 'moved');
  extracted = path.join(root, 'extracted');
  zipPath = path.join(root, 'fixtures', 'sample.zip');
  trashSource = path.join(workspace, 'a-borrar.txt');

  fs.mkdirSync(path.join(workspace, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'nota.txt'), 'hola\n');
  fs.writeFileSync(path.join(workspace, 'nested', 'fondo.txt'), 'fondo\n');
  fs.mkdirSync(path.join(treeRoot, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'uno.txt'), 'uno');
  fs.writeFileSync(path.join(treeRoot, 'sub', 'dos.txt'), 'dos');
  fs.writeFileSync(trashSource, 'borrar\n');
  fs.mkdirSync(destination);
  fs.mkdirSync(moved);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  // Keep the trash test independent of whether the runner has `gio` and a
  // desktop session. With no command on PATH the adapter takes its documented
  // XDG fallback, which is still a real move into the trash directory.
  const emptyPath = path.join(root, 'empty-path');
  fs.mkdirSync(emptyPath);

  const zip = new JSZip();
  zip.file('carpeta/extraido.txt', 'contenido extraido\n');
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

  // Every app-owned folder lives under the temporary root. HOME is redirected
  // too, because a `gio trash` fallback may choose ~/.local/share/Trash.
  server = await startServer({
    env: {
      OMNI_SESSION_TOKEN: '',
      OMNI_DATA_DIR: path.join(root, 'data'),
      OMNI_SCRATCH_DIR: path.join(root, 'scratch'),
      OMNI_LOG_DIR: path.join(root, 'logs'),
      OMNI_MAP_CACHE_DIR: path.join(root, 'map-tiles'),
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      HOME: root,
      PATH: emptyPath,
      OMNI_RUN_DRY_RUN: '1',
    },
  });

  const { status, body } = await get('/api/drives');
  expect(status).toBe(200);
  driveId = driveFor(workspace, body as Drive[]).id;
}, 40000);

afterAll(async () => {
  if (process.platform !== 'linux') return;
  await server?.stop();
  if (!root) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    fs.rmSync(root, { recursive: true, force: true });
    if (!fs.existsSync(root)) return;
    await sleep(150);
  }
}, 20000);

describe.runIf(process.platform === 'linux')('Linux filesystem integration', () => {
  it('lists a real folder', async () => {
    const { status, body } = await get(
      `/api/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(workspace)}`,
    );

    expect(status).toBe(200);
    const names = (body as { fullName: string }[]).map((entry) => entry.fullName);
    expect(names).toEqual(expect.arrayContaining(['nota.txt', 'nested']));
  });

  it('copies a folder through the job engine', async () => {
    const started = await post('/api/fs/copy', {
      sources: [path.join(workspace, 'nested')],
      targetDir: destination,
      collision: 'overwrite',
    });
    expect(started.status).toBe(200);
    await waitForJob((started.body as { jobId: string }).jobId);

    expect(fs.readFileSync(path.join(destination, 'nested', 'fondo.txt'), 'utf8')).toBe('fondo\n');
  });

  it('moves a file and renames it', async () => {
    const startMove = await post('/api/fs/move', {
      sources: [path.join(workspace, 'nota.txt')],
      targetDir: moved,
      collision: 'overwrite',
    });
    expect(startMove.status).toBe(200);
    await waitForJob((startMove.body as { jobId: string }).jobId);

    const beforeRename = path.join(moved, 'nota.txt');
    expect(fs.readFileSync(beforeRename, 'utf8')).toBe('hola\n');
    expect(fs.existsSync(path.join(workspace, 'nota.txt'))).toBe(false);

    const renamed = await post('/api/fs/rename', { path: beforeRename, newName: 'renombrada.txt' });
    expect(renamed.status).toBe(200);
    expect(fs.readFileSync(path.join(moved, 'renombrada.txt'), 'utf8')).toBe('hola\n');
    expect(fs.existsSync(beforeRename)).toBe(false);
  });

  it('walks the tree and measures it', async () => {
    const tree = await get(
      `/api/tree?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(treeRoot)}&depth=3`,
    );
    expect(tree.status).toBe(200);
    expect((tree.body as { entries: { name: string }[] }).entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'sub' })]),
    );

    const sized = await fetch(
      server.url(`/api/treesize?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(treeRoot)}`),
    );
    expect(sized.status).toBe(200);
    const messages = (await sized.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; tree?: { fileCount: number; sizeBytes: number } });
    const done = messages.find((message) => message.type === 'done');
    expect(done?.tree).toMatchObject({ fileCount: 2, sizeBytes: 6 });
  });

  it('extracts a file from a ZIP archive', async () => {
    const target = path.join(extracted, 'carpeta', 'extraido.txt');
    // This route answers newline-delimited JSON, so it is read as text instead
    // of going through the JSON helper above.
    const response = await fetch(server.url('/api/archives/extract'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: zipPath, entry: 'carpeta/extraido.txt', target, root: extracted }),
    });
    expect(response.status).toBe(200);

    const events = (await response.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; ok?: boolean });
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true });
    expect(fs.readFileSync(target, 'utf8')).toBe('contenido extraido\n');
  });

  it('moves a file to the trash', async () => {
    const started = await post('/api/fs/delete', { targets: [trashSource], useTrash: true });
    expect(started.status).toBe(200);
    await waitForJob((started.body as { jobId: string }).jobId);

    expect(fs.existsSync(trashSource)).toBe(false);
    const trashDirs = [
      path.join(root, 'xdg-data', 'Trash', 'files'),
      path.join(root, '.local', 'share', 'Trash', 'files'),
    ];
    const trashed = trashDirs.flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []));
    expect(trashed.some((name) => name === 'a-borrar.txt' || name.startsWith('a-borrar.txt.'))).toBe(true);
  });
});
