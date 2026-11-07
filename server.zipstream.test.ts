// @vitest-environment node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

/**
 * Publishing one extracted entry.
 *
 * The member is written under a temporary name beside the destination and only
 * takes its real name at the end, so a cancelled or failed extraction never
 * leaves half an entry behind. That last rename is the call Windows refuses with
 * EPERM while a scanner or the indexer holds the name, which used to abort an
 * extraction that had already written every byte; this file drives it through a
 * rename that fails once.
 */

const require = createRequire(import.meta.url);

const { extractZipEntryTo } = require('./server/zipStream.cjs') as {
  extractZipEntryTo: (
    archive: string,
    entry: string,
    destination: string,
    onBytes?: (bytes: number) => void,
    signal?: AbortSignal,
    gate?: { wait: () => Promise<void> },
  ) => Promise<number>;
};

const scratchDirs: string[] = [];

function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (scratchDirs.length > 0) {
    fs.rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  }
});

/** An `fs` whose rename answers EPERM the given number of times. */
function blockTheRename(times: number): { calls: () => number } {
  const realRename = fs.promises.rename.bind(fs.promises);
  let calls = 0;
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
    calls += 1;
    if (calls <= times) {
      const busy = new Error(`EPERM: operation not permitted, rename '${String(from)}'`) as NodeJS.ErrnoException;
      busy.code = 'EPERM';
      throw busy;
    }
    return realRename(from, to);
  });
  return { calls: () => calls };
}

describe('publishing an extracted entry', () => {
  it('reintenta el renombrado que Windows bloquea un momento', async () => {
    const dir = scratch('omni-zip-publish-');
    const memberBytes = 'hola archivo\n';
    const zip = new JSZip();
    zip.file('a.txt', memberBytes);
    const archive = path.join(dir, 'sample.zip');
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }));
    const destination = path.join(dir, 'a.txt');

    const rename = blockTheRename(1);
    const size = await extractZipEntryTo(archive, 'a.txt', destination, undefined, undefined, {
      wait: async () => undefined,
    });

    // One refused attempt and one that worked: the lock was retried, not
    // reported to a user whose extraction had already written every byte.
    expect(rename.calls()).toBe(2);
    expect(size).toBe(memberBytes.length);
    expect(fs.readFileSync(destination, 'utf8')).toBe(memberBytes);
    // The temporary is gone, so the retry left no debris beside the entry.
    expect(fs.readdirSync(dir).sort()).toEqual(['a.txt', 'sample.zip']);
  });

  it('deja el error cuando el bloqueo no se va', async () => {
    const dir = scratch('omni-zip-stuck-');
    const zip = new JSZip();
    zip.file('a.txt', 'hola archivo\n');
    const archive = path.join(dir, 'sample.zip');
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }));
    const destination = path.join(dir, 'a.txt');

    const rename = blockTheRename(Number.POSITIVE_INFINITY);

    await expect(
      extractZipEntryTo(archive, 'a.txt', destination, undefined, undefined, { wait: async () => undefined }),
    ).rejects.toThrow(/EPERM/);
    // The entry never took its name, and the temporary it was written to is
    // cleaned up instead of being left as a stray dot-file.
    expect(rename.calls()).toBe(5);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(['sample.zip']);
  });
});
