// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dashboardHtml } from './server/dashboard.cjs';

/**
 * The monitoring page is a template with no interpolated values, so nothing it
 * renders can be wrong per request. What it can get wrong is drifting away from
 * the endpoints its own script calls, which is what these assertions pin down
 * without needing a browser.
 */

const html = dashboardHtml();

describe('the transfer dashboard page', () => {
  it('is a self-contained page that needs no build step', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script src');
  });

  it('names the slots its script fills in', () => {
    for (const id of ['port', 'platform', 'uptime', 'active', 'jobs']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('calls only endpoints the server actually registers', () => {
    expect(html).toContain('/api/fs/jobs');
    expect(html).toContain('/api/fs/job/');
    expect(html).toContain('/api/fs/dashboard');
  });

  it('can steer a job from outside the app', () => {
    for (const action of ['pause', 'resume', 'cancel']) {
      expect(html).toContain(action);
    }
  });

  it('renders the same page every time', () => {
    expect(dashboardHtml()).toBe(html);
  });
});
