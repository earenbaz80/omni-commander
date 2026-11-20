// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CommonJS so the workflow can run it with plain `node`, which is how the step
// calls it: the same module, not a shape that only a bundler produces.
const loadCjs = createRequire(import.meta.url);
const { channelOf, previousVersion, versionOf } = loadCjs('./previous-release.cjs') as {
  channelOf: (version: string) => string | null;
  previousVersion: (releases: Release[], current: string) => string | null;
  versionOf: (release: { tag_name?: string }) => string;
};

interface Release {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
}

const release = (version: string, extra: Partial<Release> = {}): Release => ({ tag_name: `v${version}`, ...extra });

// The step asks the feed as the copy behind this cut, so the number it hands the
// probe decides what the check means. Naming a release in the workflow is what
// goes stale; the list is read instead, and these are the cases that answer it.
describe('the previous release the probe simulates', () => {
  it('is the newest stable release that is not this cut', () => {
    expect(previousVersion([release('1.0.53'), release('1.0.52'), release('1.0.51')], '1.0.53')).toBe('1.0.52');
  });

  it('skips a pre-release for a stable cut, whose copies read another channel', () => {
    expect(
      previousVersion([release('1.0.53'), release('1.0.53-beta.1', { prerelease: true }), release('1.0.52')], '1.0.53'),
    ).toBe('1.0.52');
  });

  // The case the check used to get wrong: a stable copy was simulated against a
  // beta cut, and a stable copy never asks for `beta-linux.yml`. The copy that
  // has to be simulated is the last beta, even with a newer stable on the page.
  it('is the newest release of the same channel for a pre-release cut', () => {
    expect(
      previousVersion(
        [release('1.0.54-beta.2'), release('1.0.53'), release('1.0.53-beta.1', { prerelease: true })],
        '1.0.54-beta.2',
      ),
    ).toBe('1.0.53-beta.1');
  });

  it('does not take a release of another channel for a pre-release cut', () => {
    // A first beta with only stable cuts behind it has no installed copy on its
    // own channel to simulate.
    expect(previousVersion([release('1.0.54-beta.1'), release('1.0.53')], '1.0.54-beta.1')).toBeNull();
    // The channel name is part of the match, not just "older than stable".
    expect(previousVersion([release('1.0.54-rc.1'), release('1.0.53-beta.1')], '1.0.54-rc.1')).toBeNull();
  });

  it('skips a draft, which no installed copy could have come from', () => {
    expect(previousVersion([release('1.0.53'), release('1.0.54', { draft: true }), release('1.0.52')], '1.0.53')).toBe(
      '1.0.52',
    );
  });

  // The fallback: the step reports it and carries on, rather than failing a cut
  // for being the first one of its channel.
  it('answers nothing when this cut is the only release of its channel', () => {
    expect(previousVersion([release('1.0.53')], '1.0.53')).toBeNull();
    expect(previousVersion([release('1.0.53'), release('1.0.53-beta.1', { prerelease: true })], '1.0.53')).toBeNull();
    expect(previousVersion([release('1.0.53-beta.1', { prerelease: true })], '1.0.53-beta.1')).toBeNull();
    expect(previousVersion([], '1.0.53')).toBeNull();
  });

  it('ignores a release without a tag instead of simulating an empty version', () => {
    expect(previousVersion([{ draft: false }, release('1.0.52')], '1.0.53')).toBe('1.0.52');
    expect(versionOf({ tag_name: 'v1.0.52' })).toBe('1.0.52');
    expect(versionOf({})).toBe('');
  });

  // The same rule the probe applies, so the two cannot disagree about which feed
  // file a copy of that version asks for.
  it('reads the channel off the version the way the probe does', () => {
    expect(channelOf('1.0.53')).toBeNull();
    expect(channelOf('1.0.53-beta.1')).toBe('beta');
    expect(channelOf('1.0.54-beta.2')).toBe('beta');
  });
});

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'previous-release.cjs');

// The workflows run the file itself, so what they get is its stdout and its exit
// code, not the return of a function. A preload answers the releases request with
// the list this test chooses, and the rest of the script runs untouched -- same
// argv, same environment, same printing.
function runCli(releases: Release[], args: string[], response = { status: 200, statusText: 'OK' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'previous-release-'));
  const preload = path.join(dir, 'fake-releases.cjs');
  fs.writeFileSync(
    preload,
    [
      `const response = ${JSON.stringify(response)};`,
      `const releases = ${JSON.stringify(releases)};`,
      'globalThis.fetch = async (url) => {',
      "  if (String(url) !== 'https://api.github.com/repos/earenbaz80/omni-commander/releases?per_page=30') {",
      '    throw new Error(`unexpected request: ${url}`);',
      '  }',
      '  return { ...response, ok: response.status < 400, json: async () => releases };',
      '};',
      '',
    ].join('\n'),
  );
  try {
    return spawnSync(process.execPath, ['-r', preload, CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REPOSITORY: 'earenbaz80/omni-commander', GITHUB_TOKEN: '' },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the previous release as the workflows ask for it', () => {
  // The step reads the number off stdout, so the answer has to arrive as one bare
  // version on its own line: anything else edits the `--installed` the probe gets.
  it('prints the version alone and exits 0 for a cut that has one behind it', () => {
    const result = runCli([release('1.0.53'), release('1.0.52'), release('1.0.51')], ['--current', '1.0.53']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1.0.52\n');
    expect(result.stderr).toBe('');
  });

  // The fallback the step turns into a notice: an empty line would be read as a
  // version, and an error would fail a cut for being the first on its channel.
  it('prints nothing and still exits 0 when the channel has no earlier release', () => {
    const result = runCli(
      [release('1.0.54-beta.1', { prerelease: true }), release('1.0.53')],
      ['--current', '1.0.54-beta.1'],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  // The other branch: GitHub can refuse the request, and then there is no fallback
  // to report. The stub answers a 403 with an empty list on purpose, which is what
  // `fetch` does -- a body that cannot be mistaken for a crash. Answering nothing
  // would look exactly like the empty answer above and quietly raise the notice
  // "no earlier release", so the step has to fail with the status instead of
  // guessing from a feed nobody could read.
  it('exits 1 and names the status when the list answers an error', () => {
    const result = runCli([], ['--current', '1.0.53'], { status: 403, statusText: 'Forbidden' });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('::error::the releases list answered 403 Forbidden');
  });
});
