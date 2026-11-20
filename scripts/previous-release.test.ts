// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

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
