// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// CommonJS so the workflow can run it with plain `node`, which is also how the
// publishing step invokes it.
const loadCjs = createRequire(import.meta.url);
const { channelNameFor, publishedReleaseDate, readChannel, verifyChannel, writeChannel } = loadCjs(
  './linux-update-channel.cjs',
) as {
  channelNameFor: (version: string) => string[];
  publishedReleaseDate: (text: string) => string | null;
  readChannel: (text: string) => { version: string | null; files: ChannelEntry[] };
  verifyChannel: (input: {
    channelFile: string;
    artifactsDir: string;
    version: string;
  }) => Array<ChannelEntry & { updater: string }>;
  writeChannel: (input: { artifactsDir: string; outDir: string; version: string; releaseDate: string }) => {
    names: string[];
    entries: ChannelEntry[];
    text: string;
  };
};

interface ChannelEntry {
  url: string;
  size: number | null;
  sha512: string | null;
}

const DEB = 'OmniCommander-Pro-9.9.9-amd64.deb';
const APPIMAGE = 'OmniCommander-Pro-9.9.9-x86_64.AppImage';
const VERSION = '9.9.9';

const created: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-channel-'));
  created.push(dir);
  return dir;
}

/** An artifacts directory with the two packages and nothing else. */
function artifacts(files: Record<string, string> = { [DEB]: 'the deb', [APPIMAGE]: 'the appimage' }): string {
  const dir = tempDir();
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), contents);
  return dir;
}

function sha512(contents: string): string {
  return crypto.createHash('sha512').update(contents).digest('base64');
}

function write(dir: string, contents = 'x'): string {
  const file = path.join(dir, 'latest-linux.yml');
  fs.writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

describe('writeChannel', () => {
  it('describes both packages with the size and the sha512 of the files themselves', () => {
    const dir = artifacts();
    const out = tempDir();
    const { text, entries } = writeChannel({
      artifactsDir: dir,
      outDir: out,
      version: VERSION,
      releaseDate: '2026-01-02T03:04:05.000Z',
    });

    expect(entries).toEqual([
      { url: DEB, size: 7, sha512: sha512('the deb') },
      { url: APPIMAGE, size: 12, sha512: sha512('the appimage') },
    ]);
    // What the updater parses, rather than the shape this writer happens to use.
    const channel = readChannel(text);
    expect(channel.version).toBe(VERSION);
    expect(channel.files.map((file) => file.url)).toEqual([DEB, APPIMAGE]);
    expect(channel.files[0].sha512).toBe(sha512('the deb'));
    expect(fs.readFileSync(path.join(out, 'latest-linux.yml'), 'utf8')).toBe(text);
  });

  it('writes the channel file of a pre-release beside the stable one', () => {
    const dir = artifacts();
    const out = tempDir();
    const { names } = writeChannel({
      artifactsDir: dir,
      outDir: out,
      version: '9.9.9-beta.1',
      releaseDate: '2026-01-02T03:04:05.000Z',
    });

    expect(names).toEqual(['latest-linux.yml', 'beta-linux.yml']);
    expect(fs.readFileSync(path.join(out, 'beta-linux.yml'), 'utf8')).toContain('version: 9.9.9-beta.1');
  });

  it('refuses a directory that does not hold exactly one package of each kind', () => {
    const twoDebs = artifacts({ [DEB]: 'one', 'OmniCommander-Pro-9.9.9-arm64.deb': 'two', [APPIMAGE]: 'three' });
    expect(() =>
      writeChannel({ artifactsDir: twoDebs, outDir: tempDir(), version: VERSION, releaseDate: 'x' }),
    ).toThrow(/2 \.deb/);

    const noAppImage = artifacts({ [DEB]: 'one' });
    expect(() =>
      writeChannel({ artifactsDir: noAppImage, outDir: tempDir(), version: VERSION, releaseDate: 'x' }),
    ).toThrow(/0 \.AppImage/);
  });
});

describe('channelNameFor', () => {
  it('adds no copy for a stable version', () => {
    expect(channelNameFor('9.9.9')).toEqual([]);
  });

  it('names the channel a pre-release asks for first', () => {
    expect(channelNameFor('9.9.9-beta.2')).toEqual(['beta-linux.yml']);
  });
});

describe('verifyChannel', () => {
  it('accepts the channel it wrote, and says which updater reads each package', () => {
    const dir = artifacts();
    const out = tempDir();
    writeChannel({ artifactsDir: dir, outDir: out, version: VERSION, releaseDate: 'x' });

    const checked = verifyChannel({
      channelFile: path.join(out, 'latest-linux.yml'),
      artifactsDir: dir,
      version: VERSION,
    });
    expect(checked.map((entry) => [entry.url, entry.updater])).toEqual([
      [DEB, 'DebUpdater'],
      [APPIMAGE, 'AppImageUpdater'],
    ]);
  });

  it('rejects a size the file does not have, which is what makes every client refuse the update', () => {
    const dir = artifacts();
    const channelFile = write(
      dir,
      'version: 9.9.9\nfiles:\n  - url: ' + DEB + '\n    sha512: ' + sha512('the deb') + '\n    size: 1\n',
    );
    expect(() => verifyChannel({ channelFile, artifactsDir: dir, version: VERSION })).toThrow(/declares 1 bytes/);
  });

  it('rejects a sha512 that disagrees with the file', () => {
    const dir = artifacts();
    const channelFile = write(
      dir,
      `version: 9.9.9\nfiles:\n  - url: ${DEB}\n    sha512: ${sha512('another build')}\n    size: 7\n  - url: ${APPIMAGE}\n    sha512: ${sha512('the appimage')}\n    size: 12\n`,
    );
    expect(() => verifyChannel({ channelFile, artifactsDir: dir, version: VERSION })).toThrow(/sha512/);
  });

  it('rejects a channel with no .deb, which DebUpdater would read as no files', () => {
    const dir = artifacts();
    const channelFile = write(
      dir,
      `version: 9.9.9\nfiles:\n  - url: ${APPIMAGE}\n    sha512: ${sha512('the appimage')}\n    size: 12\n`,
    );
    expect(() => verifyChannel({ channelFile, artifactsDir: dir, version: VERSION })).toThrow(/no \.deb entry/);
  });

  it('rejects a channel of another version, which is the stale copy a release must not carry', () => {
    const dir = artifacts();
    const channelFile = write(dir, 'version: 9.9.8\nfiles:\n');
    expect(() => verifyChannel({ channelFile, artifactsDir: dir, version: VERSION })).toThrow(
      /declares version 9\.9\.8/,
    );
  });

  it('rejects a channel naming a package the release does not publish', () => {
    const dir = artifacts();
    const out = tempDir();
    writeChannel({ artifactsDir: dir, outDir: out, version: VERSION, releaseDate: 'x' });
    fs.rmSync(path.join(dir, APPIMAGE));

    expect(() =>
      verifyChannel({ channelFile: path.join(out, 'latest-linux.yml'), artifactsDir: dir, version: VERSION }),
    ).toThrow(/not in/);
  });
});

describe('publishedReleaseDate', () => {
  it('reads the stamp the published channel carries', () => {
    expect(publishedReleaseDate("version: 9.9.9\nreleaseDate: '2026-11-20T06:37:48.709Z'\n")).toBe(
      '2026-11-20T06:37:48.709Z',
    );
    expect(publishedReleaseDate('releaseDate: 2026-11-20T06:37:48.709Z')).toBe('2026-11-20T06:37:48.709Z');
  });

  it('answers null when there is nothing usable, so the caller writes a fresh one', () => {
    expect(publishedReleaseDate('')).toBeNull();
    expect(publishedReleaseDate('version: 9.9.9\n')).toBeNull();
    expect(publishedReleaseDate("releaseDate: 'yesterday'")).toBeNull();
  });
});

// The digest of this file is recorded in the release notes, so a republication
// that changes nothing must leave the bytes, and the digest, where they were.
describe('rewriting a channel that is already published', () => {
  it('keeps the same bytes when the stamp it carries is reused', () => {
    const dir = artifacts();
    const first = tempDir();
    const { text } = writeChannel({
      artifactsDir: dir,
      outDir: first,
      version: VERSION,
      releaseDate: '2026-11-20T06:37:48.709Z',
    });

    const stamp = publishedReleaseDate(fs.readFileSync(path.join(first, 'latest-linux.yml'), 'utf8'));
    expect(stamp).toBe('2026-11-20T06:37:48.709Z');

    const second = tempDir();
    writeChannel({ artifactsDir: dir, outDir: second, version: VERSION, releaseDate: stamp! });

    expect(fs.readFileSync(path.join(second, 'latest-linux.yml'))).toEqual(
      fs.readFileSync(path.join(first, 'latest-linux.yml')),
    );
    expect(second).not.toBe(first);
    expect(text).toContain("releaseDate: '2026-11-20T06:37:48.709Z'");
  });

  it('would move the digest if the stamp were fresh, which is the bug it prevents', () => {
    const dir = artifacts();
    const a = writeChannel({
      artifactsDir: dir,
      outDir: tempDir(),
      version: VERSION,
      releaseDate: '2026-11-20T06:37:48.709Z',
    });
    const b = writeChannel({
      artifactsDir: dir,
      outDir: tempDir(),
      version: VERSION,
      releaseDate: '2026-11-20T06:38:00.000Z',
    });

    expect(a.text).not.toBe(b.text);
  });
});
