import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fsEngine, lostJobRetryPolicy } from './fileSystem';
import { Drive, FileProgressEntry, PendingConflict, TransferPlan } from '../types';

/**
 * Real drives are never mutated in memory: every copy/move/delete/mkdir/rename
 * is delegated to the local server, which owns the disk. These tests pin that
 * contract down, because a regression here silently turns real transfers back
 * into the in-memory simulation the app used to have.
 */

const realDrive: Drive = {
  id: 'real_T',
  letter: 'T:',
  name: 'Test',
  type: 'local',
  driveKind: 'fixed',
  fileSystem: 'NTFS',
  totalBytes: 1000,
  freeBytes: 500,
  isMounted: true
};

interface RecordedCall {
  url: string;
  method: string;
  body: any;
}

// The server listing contract: `name`/`ext` are a display split, `fullName` is
// the exact on-disk entry name and is the only thing that can be addressed.
const listing = [
  {
    name: 'mundo',
    ext: 'TXT',
    fullName: 'hola.mundo.txt',
    isDirectory: false,
    size: 42,
    modifiedAt: '2026-01-01 00:00:00',
    createdAt: '2026-01-01 00:00:00',
    attributes: { readOnly: false, hidden: false, system: false, archive: true },
    content: ''
  },
  {
    name: 'Python 3.11',
    ext: '',
    fullName: 'Python 3.11',
    isDirectory: true,
    size: 0,
    modifiedAt: '2026-01-01 00:00:00',
    createdAt: '2026-01-01 00:00:00',
    attributes: { readOnly: false, hidden: false, system: false, archive: false },
    content: ''
  }
];

const job = (id: string, op: string, status: string, copiedBytes = 0) => ({
  id,
  op,
  status,
  totalBytes: 100,
  copiedBytes,
  itemsTotal: 1,
  itemsDone: status === 'done' ? 1 : 0,
  itemsSkipped: 0,
  currentFile: '',
  speedBps: 0,
  etaSeconds: 0,
  errors: [] as Array<{ path: string; message: string }>
});

function installFetchMock() {
  const calls: RecordedCall[] = [];
  let polls = 0;

  const impl = async (input: any, init: any = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    const reply = (data: unknown) =>
      ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

    // The copy-list routes are matched first on purpose: their URLs contain
    // `/api/fs/copy` as a prefix and the transfer check below would swallow them.
    if (url.includes('/api/fs/copylist/save')) {
      return reply({ ok: true, path: 'C:\\Users\\test\\.omnicommander\\copy-list.json', saved: (body?.list || []).length });
    }
    if (url.includes('/api/fs/copylist/load')) {
      const bodyPath = body?.path;
      if (!bodyPath) {
        return reply({ ok: true, path: 'C:\\Users\\test\\.omnicommander\\copy-list.json', list: [], found: false });
      }
      const p = String(bodyPath);
      if (p === 'C:\\Users\\test\\.omnicommander\\copy-list.json') {
        return reply({ ok: true, path: p, list: [], found: false });
      }
      return reply({ ok: true, path: p, list: [], found: true });
    }
    if (url.includes('/api/fs/copy') || url.includes('/api/fs/move')) {
      polls = 0;
      return reply({ jobId: 'job_1', totalBytes: 100, itemsTotal: 1 });
    }
    if (url.includes('/api/fs/job/job_1')) {
      polls += 1;
      return reply(polls > 1 ? job('job_1', 'copy', 'done', 100) : job('job_1', 'copy', 'running', 0));
    }
    if (url.includes('/api/fs/delete')) {
      return reply({ jobId: 'job_2', itemsTotal: 1 });
    }
    if (url.includes('/api/fs/job/job_2')) return reply(job('job_2', 'delete', 'done'));

    // /api/list
    return reply(listing);
  };

  vi.stubGlobal('fetch', impl);
  return calls;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return predicate();
}

describe('FileSystemEngine real-drive bridge', () => {
  let calls: RecordedCall[];

  beforeEach(async () => {
    fsEngine.resetToDefaults();
    fsEngine.setDrives([realDrive]);
    calls = installFetchMock();
    await fsEngine.loadSystemDriveDirectory('real_T', 'T:');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fsEngine.resetToDefaults();
  });

  it('keeps the exact on-disk name instead of the display split', () => {
    const items = fsEngine.getFiles('real_T', 'T:');
    const file = items.find(i => i.fullName === 'hola.mundo.txt');
    const folder = items.find(i => i.fullName === 'Python 3.11');

    expect(file).toBeDefined();
    expect(folder).toBeDefined();
    // A folder must never be split into "Python 3" + extension "11".
    expect(folder!.name).toBe('Python 3.11');
    expect(folder!.ext).toBe('');
    expect(folder!.isDirectory).toBe(true);
  });

  it('copies a real file by its full on-disk name through the server', async () => {
    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    await fsEngine.copyItem(file.id, 'real_T', 'T:\\dest', true);

    const copyCall = calls.find(c => c.url.includes('/api/fs/copy'));
    expect(copyCall).toBeDefined();
    expect(copyCall!.method).toBe('POST');
    expect(copyCall!.body.sources).toEqual(['T:\\hola.mundo.txt']);
    expect(copyCall!.body.targetDir).toBe('T:\\dest');
    expect(copyCall!.body.overwrite).toBe(true);

    // The job must actually be followed to completion.
    expect(calls.some(c => c.url.includes('/api/fs/job/job_1'))).toBe(true);
  });

  it('addresses a directory by its unsplit name (no data loss on copy)', async () => {
    const folder = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'Python 3.11')!;

    await fsEngine.copyItem(folder.id, 'real_T', 'T:\\dest', true);

    const copyCall = calls.find(c => c.url.includes('/api/fs/copy'));
    expect(copyCall!.body.sources).toEqual(['T:\\Python 3.11']);
  });

  it('never overwrites when overwrite is false', async () => {
    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    await fsEngine.copyItem(file.id, 'real_T', 'T:\\dest', false);

    const copyCall = calls.find(c => c.url.includes('/api/fs/copy'));
    expect(copyCall!.body.overwrite).toBe(false);
  });

  it('replays a planned transfer from absolute paths, without the catalogue', async () => {
    // A saved copy list only keeps paths: the entry it names may be long gone
    // from the in-memory listing, and the replay still has to address the disk.
    await fsEngine.transferPaths('copy', ['T:\\externa\\gone.txt'], 'T:\\dest', true);

    const copyCall = calls.find(c => c.url.includes('/api/fs/copy'));
    expect(copyCall).toBeDefined();
    expect(copyCall!.body.sources).toEqual(['T:\\externa\\gone.txt']);
    expect(copyCall!.body.targetDir).toBe('T:\\dest');
    expect(calls.some(c => c.url.includes('/api/fs/job/job_1'))).toBe(true);
  });

  it('saves the transfer list to disk through the server', async () => {
    const plan: TransferPlan = {
      op: 'move',
      sourceDriveId: 'real_T',
      targetDriveId: 'real_T',
      targetDir: 'T:\\dest',
      overwrite: false,
      collision: 'skip',
      throttleBps: 1024,
      entries: [{ path: 'T:\\hola.mundo.txt', name: 'hola.mundo', isDirectory: false, size: 10 }]
    };

    const result = await fsEngine.saveCopyList([plan]);

    const call = calls.find(c => c.url.includes('/api/fs/copylist/save'));
    expect(call).toBeDefined();
    expect(call!.method).toBe('POST');
    expect(call!.body.list).toEqual([plan]);
    // No explicit path means the server's per-user default.
    expect(call!.body.path).toBeUndefined();
    expect(result?.saved).toBe(1);
    expect(result?.path).toContain('copy-list.json');
  });

  it('treats a missing copy list file as an empty list, not an error', async () => {
    const result = await fsEngine.loadCopyList();

    const call = calls.find(c => c.url.includes('/api/fs/copylist/load'));
    expect(call).toBeDefined();
    expect(result?.found).toBe(false);
    expect(result?.list).toEqual([]);
    expect(result?.path).toContain('copy-list.json');
  });

  it('forwards an explicit copy list path when one is given', async () => {
    await fsEngine.loadCopyList('T:\\listas\\backup.json');

    const call = calls.find(c => c.url.includes('/api/fs/copylist/load'));
    expect(call!.body.path).toBe('T:\\listas\\backup.json');
  });

  it('raises one collision prompt per destination and sends the answer back', async () => {
    let resolved: any;
    const prompts: PendingConflict[] = [];
    let snapshots = 0;

    vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
      const url = String(input);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      const reply = (data: unknown) =>
        ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

      if (url.includes('/api/fs/copy')) {
        return reply({ jobId: 'job_conflict', totalBytes: 100, itemsTotal: 1 });
      }
      if (url.includes('/api/fs/job/job_conflict/resolve')) {
        resolved = body;
        return reply(job('job_conflict', 'copy', 'done', 100));
      }
      if (url.includes('/api/fs/job/job_conflict')) {
        snapshots += 1;
        // Park for a few polls, then finish. The prompt has to be raised once
        // even though the poller keeps asking while the transfer waits.
        if (snapshots <= 3) {
          return reply({
            ...job('job_conflict', 'copy', 'waiting', 0),
            pendingConflict: { source: 'T:\\a.txt', destination: 'T:\\dest\\a.txt' }
          });
        }
        return reply(job('job_conflict', 'copy', 'done', 100));
      }
      return reply(listing);
    });

    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    await fsEngine.copyItem(
      file.id,
      'real_T',
      'T:\\dest',
      true,
      undefined,
      undefined,
      { collision: 'ask', throttleBps: 0 },
      conflict => {
        prompts.push(conflict);
        void fsEngine.resolveConflict(conflict.jobId, 'overwrite', true);
      }
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0].jobId).toBe('job_conflict');
    expect(prompts[0].destination).toBe('T:\\dest\\a.txt');
    expect(prompts[0].name).toBe('a.txt');
    expect(resolved).toEqual({ decision: 'overwrite', applyToAll: true });
  });

  it('streams the per-file progress rows reported by the engine', async () => {
    const batches: FileProgressEntry[][] = [];

    vi.stubGlobal('fetch', async (input: any) => {
      const url = String(input);
      const reply = (data: unknown) =>
        ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
      if (url.includes('/api/fs/copy')) {
        return reply({ jobId: 'job_files', totalBytes: 100, itemsTotal: 2 });
      }
      if (url.includes('/api/fs/job/job_files')) {
        return reply({ ...job('job_files', 'copy', 'done', 100), recentFiles: [
          { path: 'T:\\dest\\a.txt', name: 'a.txt', size: 100, copied: 40, status: 'copying' }
        ] });
      }
      return reply(listing);
    });

    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    await fsEngine.copyItem(
      file.id,
      'real_T',
      'T:\\dest',
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      files => batches.push(files)
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { path: 'T:\\dest\\a.txt', name: 'a.txt', size: 100, copied: 40, status: 'copying' }
    ]);
  });

  it('tolerates a snapshot without per-file rows instead of crashing', async () => {
    const batches: FileProgressEntry[][] = [];
    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    // The shared mock's job() has no `recentFiles`, which is what an older or
    // partial server response looks like.
    await fsEngine.copyItem(
      file.id,
      'real_T',
      'T:\\dest',
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      files => batches.push(files)
    );

    expect(batches.every(batch => Array.isArray(batch))).toBe(true);
  });

  it('moves a real item through the server instead of rewriting memory', async () => {
    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    await fsEngine.moveItem(file.id, 'real_T', 'T:\\dest');

    const moveCall = calls.find(c => c.url.includes('/api/fs/move'));
    expect(moveCall).toBeDefined();
    expect(moveCall!.body.sources).toEqual(['T:\\hola.mundo.txt']);
    expect(moveCall!.body.targetDir).toBe('T:\\dest');
  });

  it('deletes a real item through the server, honouring the recycle-bin setting', async () => {
    const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

    fsEngine.deleteItem(file.id, true);

    const found = await waitFor(() => calls.some(c => c.url.includes('/api/fs/delete')));
    expect(found).toBe(true);

    const deleteCall = calls.find(c => c.url.includes('/api/fs/delete'))!;
    expect(deleteCall.body.targets).toEqual(['T:\\hola.mundo.txt']);
    // Real deletes go to the Windows Recycle Bin, never the virtual one.
    expect(deleteCall.body.useTrash).toBe(true);
    expect(fsEngine.getRecycleBinItems()).toEqual([]);
  });

  it('fails the transfer when the server stops answering, instead of a fake success', async () => {
    const previous = { ...lostJobRetryPolicy };
    lostJobRetryPolicy.maxPolls = 2;
    lostJobRetryPolicy.pollDelayMs = 1;

    try {
      // The job starts, then the server dies mid-copy: every snapshot request
      // fails at the transport level. That used to look identical to a finished
      // transfer, leaving a truncated file behind a green 100%.
      vi.stubGlobal('fetch', async (input: any) => {
        const url = String(input);
        const reply = (data: unknown) =>
          ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
        if (url.includes('/api/fs/copy')) {
          return reply({ jobId: 'job_lost', totalBytes: 100, itemsTotal: 1 });
        }
        if (url.includes('/api/fs/job/job_lost')) {
          throw new TypeError('fetch failed');
        }
        return reply(listing);
      });

      const file = fsEngine.getFiles('real_T', 'T:').find(i => i.fullName === 'hola.mundo.txt')!;

      await expect(fsEngine.copyItem(file.id, 'real_T', 'T:\\dest', true)).rejects.toThrow(
        /Transfer lost/i
      );
    } finally {
      Object.assign(lostJobRetryPolicy, previous);
    }
  });
});

describe('FileSystemEngine drive hot-plug refresh', () => {
  const usbDrive: Drive = {
    id: 'real_E',
    letter: 'E:',
    name: 'USB STICK',
    type: 'usb',
    driveKind: 'removable',
    fileSystem: 'FAT32',
    totalBytes: 2000,
    freeBytes: 1000,
    isMounted: true
  };

  const drivesReply = (drives: unknown) =>
    ({ ok: true, status: 200, json: async () => drives }) as unknown as Response;

  beforeEach(() => {
    fsEngine.resetToDefaults();
    fsEngine.setDrives([realDrive]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fsEngine.resetToDefaults();
  });

  it('picks up a removable drive plugged in after startup', async () => {
    vi.stubGlobal('fetch', async () => drivesReply([realDrive, usbDrive]));

    const ok = await fsEngine.loadRealDrivesFromApi();

    expect(ok).toBe(true);
    expect(fsEngine.getDrives().map(d => d.letter)).toEqual(['T:', 'E:']);
  });

  it('drops a drive that was unplugged', async () => {
    fsEngine.setDrives([realDrive, usbDrive]);

    vi.stubGlobal('fetch', async () => drivesReply([realDrive]));
    await fsEngine.loadRealDrivesFromApi();

    expect(fsEngine.getDrives().map(d => d.letter)).toEqual(['T:']);
  });

  it('does not churn subscribers or storage when the list is unchanged', async () => {
    vi.stubGlobal('fetch', async () => drivesReply([{ ...realDrive }]));

    let notified = 0;
    const unsubscribe = fsEngine.subscribe(() => { notified += 1; });
    try {
      const ok = await fsEngine.loadRealDrivesFromApi();

      expect(ok).toBe(true);
      // A poll every few seconds must cost one fetch and nothing else.
      expect(notified).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('reports failure without wiping the known drive list', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });

    const ok = await fsEngine.loadRealDrivesFromApi();

    expect(ok).toBe(false);
    expect(fsEngine.getDrives().map(d => d.letter)).toEqual(['T:']);
  });
});
