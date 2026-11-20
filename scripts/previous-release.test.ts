// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// CommonJS so the workflow can run it with plain `node`, which is how the step
// calls it: the same module, not a shape that only a bundler produces.
const loadCjs = createRequire(import.meta.url);
const { previousVersion, versionOf } = loadCjs('./previous-release.cjs') as {
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

  it('skips a pre-release, whose copies read another channel', () => {
    expect(
      previousVersion([release('1.0.53'), release('1.0.53-beta.1', { prerelease: true }), release('1.0.52')], '1.0.53'),
    ).toBe('1.0.52');
  });

  it('skips a draft, which no installed copy could have come from', () => {
    expect(previousVersion([release('1.0.53'), release('1.0.54', { draft: true }), release('1.0.52')], '1.0.53')).toBe(
      '1.0.52',
    );
  });

  // The fallback: the step reports it and carries on, rather than failing a cut
  // for being the first one.
  it('answers nothing when this cut is the only stable release', () => {
    expect(previousVersion([release('1.0.53')], '1.0.53')).toBeNull();
    expect(previousVersion([release('1.0.53'), release('1.0.53-beta.1', { prerelease: true })], '1.0.53')).toBeNull();
    expect(previousVersion([], '1.0.53')).toBeNull();
  });

  it('ignores a release without a tag instead of simulating an empty version', () => {
    expect(previousVersion([{ draft: false }, release('1.0.52')], '1.0.53')).toBe('1.0.52');
    expect(versionOf({ tag_name: 'v1.0.52' })).toBe('1.0.52');
    expect(versionOf({})).toBe('');
  });
});
