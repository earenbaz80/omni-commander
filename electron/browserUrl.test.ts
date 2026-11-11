import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The address bar is the one place where text a user types becomes a page inside
 * the app, so the rule it applies is worth pinning down: http(s) only, a bare
 * host gets the scheme a browser would use, and anything else is refused rather
 * than loaded with a dangerous one.
 */
const require = createRequire(import.meta.url);
const { normalizeBrowserUrl } = require('./browserUrl.cjs') as {
  normalizeBrowserUrl: (input: unknown) => string | null;
};

describe('the browser address normalizer', () => {
  it('adds https to a bare host', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/');
    expect(normalizeBrowserUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('reaches a local server over http', () => {
    expect(normalizeBrowserUrl('localhost:3020')).toBe('http://localhost:3020/');
    expect(normalizeBrowserUrl('127.0.0.1:3001/api/share')).toBe('http://127.0.0.1:3001/api/share');
    expect(normalizeBrowserUrl('192.168.1.10:8090/s/abc')).toBe('http://192.168.1.10:8090/s/abc');
  });

  it('keeps a scheme the user typed', () => {
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com/');
  });

  it('refuses everything that is not the web', () => {
    expect(normalizeBrowserUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBrowserUrl('file:///C:/Windows/win.ini')).toBeNull();
    expect(normalizeBrowserUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(normalizeBrowserUrl('about:blank')).toBeNull();
  });

  it('has nothing to load for empty or unusable input', () => {
    expect(normalizeBrowserUrl('')).toBeNull();
    expect(normalizeBrowserUrl('   ')).toBeNull();
    expect(normalizeBrowserUrl(null)).toBeNull();
    expect(normalizeBrowserUrl('not a url')).toBeNull();
  });

  it('does not treat a port as a scheme', () => {
    // "example.com:8080" reads as scheme "example.com:" if the `//` is ignored.
    expect(normalizeBrowserUrl('example.com:8080')).toBe('https://example.com:8080/');
  });
});
