// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// CommonJS so the workflow can run it with plain `node`; the test loads the same
// module the step does.
const loadCjs = createRequire(import.meta.url);
const { channelOf, probe } = loadCjs('./probe-linux-updater.cjs') as {
  channelOf: (version: string) => string | null;
  probe: (input: {
    version: string;
    installed?: string;
    channel?: string | null;
  }) => Promise<{ version: string; files: unknown[] }>;
};

describe('the channel a version asks for', () => {
  // GitHubProvider reads `/releases/latest` when there is no channel, and that
  // endpoint never returns a prerelease. Asking without one from a beta build
  // finds the previous stable and reports it as if the feed were behind.
  it.each([
    ['1.0.53', null],
    ['1.0.53-beta.1', 'beta'],
    ['1.0.52-rc.2', 'rc'],
    ['1.0.53-beta', 'beta'],
  ])('%s asks for %s', (version, expected) => {
    expect(channelOf(version)).toBe(expected);
  });
});

// The two numbers mean different things: one is the copy being simulated, the
// other the cut the feed has to offer. Passing the same one twice would ask the
// feed whether it has what it already served, so it is refused before any request.
describe('the copy a probe simulates', () => {
  it('refuses an installed version equal to the cut it should find', async () => {
    await expect(probe({ version: '1.0.53', installed: '1.0.53' })).rejects.toThrow(
      /--installed is the version of the copy/,
    );
  });

  // A copy reads the feed file of its own channel, so a stable number asked
  // against a beta cut describes no machine at all. Without this guard the probe
  // would make the request and report the answer as a tree that is not the newest
  // cut, which points at the wrong thing: the arguments are what disagree.
  it('refuses a stable copy when the cut is a prerelease', async () => {
    await expect(probe({ version: '1.0.54-beta.1', installed: '1.0.53' })).rejects.toThrow(
      /--installed 1\.0\.53 reads latest-linux\.yml while this probe asks for beta-linux\.yml/,
    );
  });

  it('refuses a beta copy when the cut is stable', async () => {
    await expect(probe({ version: '1.0.53', installed: '1.0.50-beta.1' })).rejects.toThrow(
      /--installed 1\.0\.50-beta\.1 reads beta-linux\.yml while this probe asks for latest-linux\.yml/,
    );
  });

  // `--channel` overrides the channel the cut's suffix implies, so the two
  // numbers can agree with each other and the request still land on a feed the
  // copy never reads. The guard has to compare against what the probe asks for,
  // which is the effective channel, not the one `--version` spells out.
  it('refuses a copy whose channel is not the one --channel asks for', async () => {
    await expect(probe({ version: '1.0.53', installed: '1.0.52', channel: 'beta' })).rejects.toThrow(
      /--installed 1\.0\.52 reads latest-linux\.yml while this probe asks for beta-linux\.yml/,
    );
  });
});
