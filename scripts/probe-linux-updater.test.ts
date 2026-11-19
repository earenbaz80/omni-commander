// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// CommonJS so the workflow can run it with plain `node`; the test loads the same
// module the step does.
const loadCjs = createRequire(import.meta.url);
const { channelOf } = loadCjs('./probe-linux-updater.cjs') as {
  channelOf: (version: string) => string | null;
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
