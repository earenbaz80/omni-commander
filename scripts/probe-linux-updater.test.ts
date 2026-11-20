// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// CommonJS so the workflow can run it with plain `node`; the test loads the same
// module the step does.
const loadCjs = createRequire(import.meta.url);
const { channelOf, probe } = loadCjs('./probe-linux-updater.cjs') as {
  channelOf: (version: string) => string | null;
  probe: (input: { version: string; installed?: string }) => Promise<{ version: string; files: unknown[] }>;
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
});
