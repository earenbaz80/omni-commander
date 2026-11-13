// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { dashboardHtml } from './server/dashboard.cjs';

/**
 * The monitoring page is a template with no interpolated values, so nothing it
 * renders can be wrong per request. What it can get wrong is drifting away from
 * the endpoints its own script calls, which is what these assertions pin down
 * without needing a browser.
 */

const html = dashboardHtml();

/** The page's own script, taken from the page as it ships. */
function pageScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return match![1];
}

describe('the transfer dashboard page', () => {
  it('carries its own style and script instead of loading them', () => {
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script src');
  });

  it('reaches the endpoints the page cannot work without', () => {
    // The job list is pinned by the rows the harness renders; these two are the
    // metadata counters and the action a button posts to.
    expect(html).toContain('/api/fs/dashboard');
    expect(html).toContain('/api/fs/job/');
  });

  it('renders the same page every time', () => {
    expect(dashboardHtml()).toBe(html);
  });

  it('lints the script it carries as source', async () => {
    // The script lives in a template string, so it reaches the browser without
    // passing through the linter. Here it is linted as the file it would be, with
    // the browser globals it calls, so an unused name or an undeclared global is
    // caught by the suite instead of by the operator reading the page.
    const eslint = new ESLint({
      overrideConfig: {
        languageOptions: {
          globals: { document: 'readonly', fetch: 'readonly', setInterval: 'readonly' },
        },
      },
    });

    const [result] = await eslint.lintText(pageScript(), { filePath: 'server/dashboard.script.js' });

    expect(result.messages).toEqual([]);
  });
});

/**
 * Runs the page's own script against one job, without a browser.
 *
 * The sizes and the speed are painted by that script and nothing else, so a test
 * that only read the template would pass on any unit it printed. Here the script
 * is taken as it ships, given a fake document and a fake `fetch`, and the row it
 * wrote is what gets read.
 *
 * Coverage never measures this script, so the rows read below are the only check
 * on its figures. Extracting it into a module to be measured would cost the one
 * thing the page is for: a single file, no build step, that still works when the
 * renderer is what broke.
 */
async function renderJobs(jobs: unknown[]): Promise<string> {
  const host = { innerHTML: '' };
  // One node per id, not a shared stand-in: a write aimed at the wrong slot has
  // to land somewhere the real page does not have, and be noticed below.
  const nodes = new Map<string, { textContent: string }>();
  const document = {
    getElementById: (id: string) => {
      if (id === 'jobs') return host;
      const node = nodes.get(id) ?? { textContent: '' };
      nodes.set(id, node);
      return node;
    },
    addEventListener: () => {},
  };
  // Four values that cannot be confused on sight, so a swapped assignment is
  // visible rather than rendering a plausible number in the wrong slot.
  const meta = { port: 8787, platform: 'win32', uptimeSeconds: 3660, activeCount: 3 };
  const fetch = async (url: string) => ({
    json: async () => (url === '/api/fs/jobs' ? jobs : meta),
  });
  // The page polls forever; the first pass is all this test needs.
  const setInterval = () => 0;

  new Function('document', 'fetch', 'setInterval', pageScript())(document, fetch, setInterval);
  // The row is written from the promise the first `tick` started.
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();

  // Every slot the script reached for must exist in the page it ships with and
  // hold the figure meant for it; an id nobody listed here fails instead of
  // passing quietly.
  const shown: Record<string, string> = { port: '8787', platform: 'win32', uptime: '1h 1m', active: '3' };
  for (const [id, node] of nodes) {
    expect(html).toContain(`id="${id}"`);
    expect(String(node.textContent), id).toBe(shown[id]);
  }

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
    expect(row).toContain('eta <b>30s</b>');
    expect(row).toContain('Pause');
    expect(row).toContain('Cancel');
    expect(row).toContain('items <b>1</b> / 2');
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
      job({
        copiedBytes: 'muchos',
        recentFiles: [
          { name: 'uno', size: 100, copied: 'x', status: 'pending' },
          { name: 'dos', size: 100, copied: 100, status: 'skipped' },
          { name: 'tres', size: 100, copied: 0, status: 'error' },
        ],
      }),
    ]);

    expect(row).toContain('progress <b>0%</b>');
    expect(row).not.toContain('NaN');

    // Each file row carries its name, its own bar and what happened to it: a
    // percentage while it is under way, a word once it was skipped or failed.
    expect(row).toContain('<span class="fn">uno</span>');
    expect(row).toContain('<span class="fb"><i style="width:0%"></i></span>');
    expect(row).toContain('<span class="fp">0%</span>');
    expect(row).toContain('<span class="fp">skip</span>');
    expect(row).toContain('<span class="fp">fail</span>');

    // A job that reports no size is no progress either, not a full bar.
    const noTotal = await renderJobs([job({ totalBytes: 0 })]);
    expect(noTotal).toContain('progress <b>0%</b>');
  });

  it('keeps the speed in megabytes per second past a gigabyte a second', async () => {
    const row = await renderJobs([job({ speedBps: 1.5 * 1024 * 1024 * 1024, etaSeconds: 3660 })]);

    expect(row).toContain('<b>1536 MB/s</b>');
    expect(row).toContain('eta <b>1h 1m</b>');
    expect(row).not.toContain('GB/s');
    expect(row).not.toContain('KB/s');
  });

  it('drops the trailing zero of a whole speed and keeps the decimal of the rest', async () => {
    const whole = await renderJobs([job({ speedBps: 1024 * 1024, etaSeconds: 90 })]);
    expect(whole).toContain('<b>1 MB/s</b>');
    expect(whole).toContain('eta <b>1m 30s</b>');

    const fractional = await renderJobs([job({ speedBps: 1.5 * 1024 * 1024 })]);
    expect(fractional).toContain('<b>1.5 MB/s</b>');
  });

  it('shows no speed for a job that is not running', async () => {
    const paused = await renderJobs([job({ status: 'paused' })]);
    expect(paused).toContain('speed <b>-</b>');
    // A paused job is the one that offers the other action.
    expect(paused).toContain('Resume');

    const stopped = await renderJobs([job({ speedBps: 0, etaSeconds: 0 })]);
    expect(stopped).toContain('speed <b>-</b>');
    expect(stopped).toContain('eta <b>-</b>');
  });
});
