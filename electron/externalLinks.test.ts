// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * The shell is the only way out of the sandboxed window, so this filter is the
 * boundary between a link in the settings and the operating system opening an
 * arbitrary address.
 */
const require = createRequire(import.meta.url);
const { isAllowedExternalTarget, TOKEN_PAGE } = require('./externalLinks.cjs') as {
  isAllowedExternalTarget: (target: unknown) => boolean;
  TOKEN_PAGE: string;
};

describe('isAllowedExternalTarget', () => {
  it('acepta la página del token y las que cuelgan de ella', () => {
    expect(isAllowedExternalTarget(TOKEN_PAGE)).toBe(true);
    expect(isAllowedExternalTarget(`${TOKEN_PAGE}/new`)).toBe(true);
    expect(isAllowedExternalTarget('https://github.com/settings/personal-access-tokens/new?x=1')).toBe(true);
  });

  it('rechaza otro sitio que solo lo parece', () => {
    expect(isAllowedExternalTarget('https://github.com@evil.com/settings/personal-access-tokens/new')).toBe(false);
    expect(isAllowedExternalTarget('https://github.com.evil.com/settings/personal-access-tokens')).toBe(false);
    expect(isAllowedExternalTarget('https://evil.com/settings/personal-access-tokens/new')).toBe(false);
  });

  it('rechaza rutas vecinas y otros esquemas', () => {
    expect(isAllowedExternalTarget('https://github.com/settings/personal-access-tokensXYZ')).toBe(false);
    expect(isAllowedExternalTarget('https://github.com/settings/profile')).toBe(false);
    expect(isAllowedExternalTarget('http://github.com/settings/personal-access-tokens/new')).toBe(false);
    expect(isAllowedExternalTarget('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalTarget('file:///C:/Windows/System32/calc.exe')).toBe(false);
  });

  it('rechaza lo que no es una URL utilizable', () => {
    expect(isAllowedExternalTarget('')).toBe(false);
    expect(isAllowedExternalTarget('no es una url')).toBe(false);
    expect(isAllowedExternalTarget(null)).toBe(false);
    expect(isAllowedExternalTarget(42)).toBe(false);
  });
});
