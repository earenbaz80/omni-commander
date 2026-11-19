// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// CommonJS so both workflows can run it with plain `node`, which is how they
// invoke it in the packaging steps.
const loadCjs = createRequire(import.meta.url);
const { accepts, debianSpelling } = loadCjs('./check-deb-version.cjs') as {
  accepts: (version: string, actual: string) => boolean;
  debianSpelling: (version: string) => string;
};

describe('the version a .deb may carry', () => {
  it('writes a prerelease the way Debian can: the hyphen becomes a tilde', () => {
    expect(debianSpelling('1.0.53-beta.1')).toBe('1.0.53~beta.1');
    expect(debianSpelling('1.0.52')).toBe('1.0.52');
  });

  // Both spellings went through this check on purpose: the tag and the preflight
  // each went red once on a correct prerelease package before it accepted both.
  it.each([
    ['1.0.53-beta.1', '1.0.53~beta.1', true],
    ['1.0.53-beta.1', '1.0.53-beta.1', true],
    ['1.0.52', '1.0.52', true],
    ['1.0.53-beta.1', '1.0.52', false],
    ['1.0.53-beta.1', '9.9.9', false],
    ['1.0.52', '1.0.52~1', false],
  ])('%s accepts %s: %s', (version, actual, expected) => {
    expect(accepts(version as string, actual as string)).toBe(expected);
  });
});
