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

/**
 * Runs the page's own script against one job, without a browser.
 *
 * The sizes and the speed are painted by that script and nothing else, so a test
 * that only read the template would pass on any unit it printed. Here the script
 * is taken as it ships, given a fake document and a fake `fetch`, and the row it
 * wrote is what gets read.
 */
async function renderJobs(jobs: unknown[]): Promise<string> {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  expect(script).not.toBeNull();

  const host = { innerHTML: '' };
  const idle = { textContent: '' };
  const document = {
    getElementById: (id: string) => (id === 'jobs' ? host : idle),
    addEventListener: () => {},
  };
  const fetch = async (url: string) => ({
    json: async () => (url === '/api/fs/jobs' ? jobs : { port: 1, platform: 'test', uptimeSeconds: 0, activeCount: 0 }),
  });
  // The page polls forever; the first pass is all this test needs.
  const setInterval = () => 0;

  new Function('document', 'fetch', 'setInterval', script![1])(document, fetch, setInterval);
  // The row is written from the promise the first `tick` started.
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();

  return host.innerHTML;
}

describe('the dashboard row', () => {
  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    status: 'running',
    op: 'copy',
    label: 'respaldo',
    copiedBytes: 512 * 1024 * 1024,
    totalBytes: 1024 * 1024 * 1024,
    speedBps: 512 * 1024 * 1024,
    etaSeconds: 30,
    itemsDone: 1,
    itemsTotal: 2,
    ...overrides,
  });

  /** The "copied X / Y" pair, read back out of the row the script wrote. */
  const sizes = (row: string) => /copied <b>(.*?)<\/b> \/ (.*?)<\/span>/.exec(row)?.slice(1) ?? [];

  it('prints every size in its own unit', async () => {
    const cases: Array<[number, string]> = [
      [0, '0 B'],
      [512, '512 B'],
      [1536, '1.5 KB'],
      [512 * 1024 * 1024, '512.0 MB'],
      [1024 * 1024 * 1024, '1.0 GB'],
      [2.5 * 1024 * 1024 * 1024, '2.5 GB'],
    ];

    for (const [bytes, expected] of cases) {
      const row = await renderJobs([job({ copiedBytes: bytes, totalBytes: bytes })]);
      expect(sizes(row), `${bytes} bytes`).toEqual([expected, expected]);
    }
  });

  it('never lets a copied total push the bar past its end', async () => {
    // A total the job restated can leave more copied than the new size; the cap
    // is what keeps the fill inside the bar instead of overflowing it.
    const row = await renderJobs([job({ copiedBytes: 2 * 1024 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 })]);

    expect(row).toContain('width:100%');
  });

  it('reads a size that is not a number as nothing copied', async () => {
    // The row prints whatever the job reports, and a field that never arrived
    // must not reach the operator as "NaN B".
    const row = await renderJobs([job({ copiedBytes: 'muchos', totalBytes: null })]);

    expect(sizes(row)).toEqual(['0 B', '0 B']);
  });

  it('shows no progress when a count cannot be read', async () => {
    // The bar is built from two fields; the row and its current file both used
    // to divide whatever arrived, which painted "NaN%" over a running job.
    const row = await renderJobs([
      job({ copiedBytes: 'muchos', recentFiles: [{ name: 'a', size: 100, copied: 'x', status: 'pending' }] }),
    ]);

    expect(row).toContain('progress <b>0%</b>');
    expect(row).toContain('<span class="fp">0%</span>');
    expect(row).not.toContain('NaN');

    // A job that reports no size is no progress either, not a full bar.
    const noTotal = await renderJobs([job({ totalBytes: 0 })]);
    expect(noTotal).toContain('progress <b>0%</b>');
  });

  it('keeps the speed in megabytes per second past a gigabyte a second', async () => {
    const row = await renderJobs([job({ speedBps: 1.5 * 1024 * 1024 * 1024 })]);

    expect(row).toContain('<b>1536 MB/s</b>');
    expect(row).not.toContain('GB/s');
    expect(row).not.toContain('KB/s');
  });

  it('drops the trailing zero of a whole speed and keeps the decimal of the rest', async () => {
    const whole = await renderJobs([job({ speedBps: 1024 * 1024 })]);
    expect(whole).toContain('<b>1 MB/s</b>');

    const fractional = await renderJobs([job({ speedBps: 1.5 * 1024 * 1024 })]);
    expect(fractional).toContain('<b>1.5 MB/s</b>');
  });

  it('shows no speed for a job that is not running', async () => {
    const paused = await renderJobs([job({ status: 'paused' })]);
    expect(paused).toContain('speed <b>-</b>');

    const stopped = await renderJobs([job({ speedBps: 0 })]);
    expect(stopped).toContain('speed <b>-</b>');
  });
});
