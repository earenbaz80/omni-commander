// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dashboardUrl } from './electron/dashboardUrl.cjs';

/**
 * The tray is the only place the port and the per-launch token meet, and the URL
 * it builds is opened by a browser navigation: a token that slipped into the
 * path, or a port that landed after the page, would still look like a URL here
 * and fail only in the browser. These cases pin each part to its own place.
 */
describe('the dashboard URL the tray opens', () => {
  it('reads as the page on the bound port, with the token in the query', () => {
    expect(dashboardUrl(62412, 'abc123')).toBe('http://127.0.0.1:62412/__jobs?t=abc123');
  });

  it('keeps the port in the authority and the page in the path', () => {
    const url = new URL(dashboardUrl(62412, 'abc123') as string);
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('62412');
    expect(url.pathname).toBe('/__jobs');
    expect([...url.searchParams.keys()]).toEqual(['t']);
    expect(url.searchParams.get('t')).toBe('abc123');
  });

  it('escapes a token that would otherwise end the query early', () => {
    expect(dashboardUrl(3001, 'a b&c')).toBe('http://127.0.0.1:3001/__jobs?t=a%20b%26c');
    expect(new URL(dashboardUrl(3001, 'a b&c') as string).searchParams.get('t')).toBe('a b&c');
  });

  it('has no URL before the port is known', () => {
    expect(dashboardUrl(null, 'abc123')).toBeNull();
    expect(dashboardUrl(undefined, 'abc123')).toBeNull();
  });
});
