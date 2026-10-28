// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchivePasswordError } from './archiveBackend';
import { ArchiveServerUnavailableError, loadServerArchiveBackend } from './serverArchive';

/**
 * The bridge is the only place the renderer talks to libarchive, and it can only
 * be exercised through HTTP: the real engine lives on the server. These tests
 * pin the wire contract -- what is asked, what comes back, and which error the
 * caller sees -- without a browser or a WASM worker.
 */

const TARGET = 'C:\\archivos\\copia.rar';
const entries = [
  { name: 'sub', dir: true, size: 0, date: 1705314600000 },
  { name: 'sub/b.txt', dir: false, size: 22, date: 1705314600000 },
  { name: 'a.txt', dir: false, size: 13, date: 1705314600000 },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('loadServerArchiveBackend', () => {
  it('lists what the server reports and fetches one entry at a time', async () => {
    const calls: { route: string; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const route = String(url).split('/').pop()!;
        const body = JSON.parse(String(init.body));
        calls.push({ route, body });
        if (route === 'inspect') return json({ entries });
        return new Response(new Uint8Array([104, 105]), { status: 200 });
      }),
    );

    const backend = await loadServerArchiveBackend(TARGET, 'copia.rar', 'RAR');

    expect(backend.format).toBe('RAR');
    expect(backend.entries.map((entry) => entry.name)).toEqual(['sub', 'sub/b.txt', 'a.txt']);
    expect(backend.entries[0].dir).toBe(true);
    expect(backend.entries[2].date).toBeInstanceOf(Date);
    // Nothing is fetched until an entry is actually read, and a directory never
    // costs a request at all.
    expect(calls).toEqual([{ route: 'inspect', body: { path: TARGET, password: undefined } }]);
    await expect(backend.entries[0].read()).resolves.toEqual(new Uint8Array(0));
    expect(calls).toHaveLength(1);
    expect([...(await backend.entries[1].read())]).toEqual([104, 105]);
    expect([...(await backend.readEntry('sub/b.txt'))]).toEqual([104, 105]);
    expect(calls.slice(1)).toEqual([
      { route: 'entry', body: { path: TARGET, entry: 'sub/b.txt', password: undefined } },
      { route: 'entry', body: { path: TARGET, entry: 'sub/b.txt', password: undefined } },
    ]);
  });

  it('turns a missing passphrase into the prompt instead of a broken file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'password-required', error: 'Passphrase required' }, 400)),
    );

    const error = await loadServerArchiveBackend(TARGET, 'copia.rar', 'RAR').catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ArchivePasswordError);
    expect(error.name).toBe('ArchivePasswordError');
    expect((error as Error).message).toContain('copia.rar');
  });

  it('tells a wrong password apart from a missing one, so the prompt can say so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'password-required', reason: 'invalid', error: 'Wrong password' }, 400)),
    );

    const error = await loadServerArchiveBackend(TARGET, 'copia.rar', 'RAR', 'equivocada').catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ArchivePasswordError);
    expect((error as ArchivePasswordError).reason).toBe('invalid');
  });

  it('says the server is unavailable, not that the archive is damaged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const error = await loadServerArchiveBackend(TARGET, 'copia.7z', '7Z').catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ArchiveServerUnavailableError);
    expect((error as Error).message).toContain('7-Zip');
  });

  it('says the archive is over the memory ceiling instead of calling it corrupt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'too-large', sizeBytes: 900 * 1024 * 1024, limitBytes: 512 * 1024 * 1024 }, 413)),
    );

    const error = (await loadServerArchiveBackend(TARGET, 'copia.rar', 'RAR').catch((thrown) => thrown)) as Error;

    expect(error).not.toBeInstanceOf(ArchivePasswordError);
    expect(error.message).toContain('copia.rar');
    expect(error.message).toContain('512 MB');
    // No placeholder may survive to the screen.
    expect(error.message).not.toMatch(/\{(name|size)\}/);
  });

  it('reports a read failure with the file name, claiming no format it did not parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'read-failed', error: 'Failed to open archive' }, 400)),
    );

    const error = await loadServerArchiveBackend(TARGET, 'copia.7z', '7Z').catch((thrown) => thrown);

    expect(error).not.toBeInstanceOf(ArchivePasswordError);
    expect((error as Error).message).toContain('copia.7z');
  });
});
