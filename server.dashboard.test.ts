// @vitest-environment node
import { ESLint } from 'eslint';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { dashboardHtml } from './server/dashboard.cjs';

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

  it('says which process the uptime pill counts', () => {
    // The figure is `process.uptime()` of whatever serves the page, so the label
    // cannot promise the machine's uptime or the transfer engine's own.
    expect(html).toContain('process up <b id="uptime">');
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
          globals: {
            document: 'readonly',
            fetch: 'readonly',
            setInterval: 'readonly',
            location: 'readonly',
            URLSearchParams: 'readonly',
          },
        },
      },
    });

    const [result] = await eslint.lintText(pageScript(), { filePath: 'server/dashboard.script.js' });

    expect(result.messages).toEqual([]);
  });
});

/**
 * Runs the page's own script against some jobs, without a browser.
 *
 * The rows are painted by that script and nothing else, so a test that only read
 * the template would pass on any figure it printed. Coverage never measures it
 * either, and extracting it into a module to be measured would cost the point of
 * the page: one file, no build step, still working when the renderer is what broke.
 */
async function renderJobs(jobs: unknown[]): Promise<string> {
  // No tree behind this host: the rows are read as text. The one behaviour that
  // needs real nodes -- a press surviving a rebuild -- is checked in jsdom below.
  const host = { innerHTML: '', querySelectorAll: () => [] as never[] };
  // One node per id, not a shared stand-in: a write aimed at the wrong slot has
  // to land somewhere the real page does not have, and be noticed below.
  const nodes = new Map<string, { textContent: string }>();
  const clicks: Array<(event: any) => void> = [];
  const document = {
    getElementById: (id: string) => {
      if (id === 'jobs') return host;
      const node = nodes.get(id) ?? { textContent: '' };
      nodes.set(id, node);
      return node;
    },
    addEventListener: (type: string, handler: (event: any) => void) => {
      if (type === 'click') clicks.push(handler);
    },
  };
  // Four values that cannot be confused on sight, so a swapped assignment is
  // visible rather than rendering a plausible number in the wrong slot.
  const meta = { port: 8787, platform: 'win32', uptimeSeconds: 3660, activeCount: 3 };
  const calls: Array<{ request: string; token?: string }> = [];
  const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ request: `${init?.method ?? 'GET'} ${url}`, token: init?.headers?.['x-omni-token'] });
    if (url === '/api/fs/jobs') return { json: async () => jobs };
    if (url === '/api/fs/dashboard') return { json: async () => meta };
    // A route the page made up rejects, and the slot check below then fails.
    throw new Error(`unexpected ${url}`);
  };
  // The page polls forever; the first pass is all this test needs.
  const setInterval = () => 0;

  // The page is opened with its token in the URL, the one place a navigation can
  // carry it; everything it calls afterwards has to prove itself with a header.
  const location = { search: '?t=page-token' };
  new Function('document', 'fetch', 'setInterval', 'location', 'URLSearchParams', pageScript())(
    document,
    fetch,
    setInterval,
    location,
    URLSearchParams,
  );
  // The row is written from the promise the first `tick` started.
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();

  // Every slot the script reached for must exist in the page and hold the figure
  // meant for it. The set is checked first, so a run where the page reached no
  // slot at all -- a route it made up rejected -- fails instead of checking
  // nothing.
  const shown: Record<string, string> = { port: '8787', platform: 'win32', uptime: '1h 1m', active: '3' };
  expect([...nodes.keys()].sort()).toEqual(Object.keys(shown).sort());
  for (const [id, text] of Object.entries(shown)) {
    expect(html).toContain(`id="${id}"`);
    expect(String(nodes.get(id)?.textContent), id).toBe(text);
  }

  // Clicking a row's button posts the action to the job it belongs to.
  expect(clicks).toHaveLength(1);
  const button = { getAttribute: (name: string) => (name === 'data-act' ? 'pause' : 'job-1') };
  clicks[0]({ target: { closest: () => button } });
  expect(calls.map((call) => call.request)).toContain('POST /api/fs/job/job-1/pause');
  // Every request carries the token as a header, never as part of its URL.
  expect(calls.every((call) => call.token === 'page-token')).toBe(true);

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

  it('keeps the bar inside its lane and the rows in the order it sorts them', async () => {
    // A total the job restated can leave more copied than the new size; the cap
    // is what keeps the fill inside the bar instead of overflowing it.
    const row = await renderJobs([job({ copiedBytes: 2 * 1024 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 })]);

    expect(row).toContain('width:100%');
    expect(row).toContain('eta <b>30s</b>');
    expect(row).toContain('Pause');
    expect(row).toContain('Cancel');
    expect(row).toContain('items <b>1</b> / 2');

    // The engine sends the list in whatever order it likes: work still moving
    // goes on top, and the newest of a status above the older ones.
    const ordered = await renderJobs([
      job({ label: 'terminado', status: 'done', startedAt: 300 }),
      job({ label: 'en curso viejo', status: 'running', startedAt: 100 }),
      job({ label: 'pausado', status: 'paused', startedAt: 200 }),
      job({ label: 'en curso nuevo', status: 'running', startedAt: 400 }),
    ]);
    const at = (label: string) => ordered.indexOf(`class="name">${label}<`);
    const order = ['en curso nuevo', 'en curso viejo', 'pausado', 'terminado'].map(at);
    // A name that never rendered would come back as -1 and sort first.
    expect(Math.min(...order)).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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
        errors: [{ path: '<ruta>', message: 'no "pudo" & <leer>' }],
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

    // A failed job lists what went wrong, with the path and the message escaped.
    expect(row).toContain(
      '<div class="errs"><div>&lt;ruta&gt; &mdash; no &quot;pudo&quot; &amp; &lt;leer&gt;</div></div>',
    );

    // A job that reports no size is no progress either, not a full bar.
    const noTotal = await renderJobs([job({ totalBytes: 0 })]);
    expect(noTotal).toContain('progress <b>0%</b>');
  });

  it('prints the speed in megabytes per second, whole or not', async () => {
    // Past a gigabyte a second it still counts in megabytes, which is the unit the
    // window prints; a whole figure loses its trailing zero and the rest keeps it.
    const big = await renderJobs([job({ speedBps: 1.5 * 1024 * 1024 * 1024, etaSeconds: 3660 })]);
    expect(big).toContain('<b>1536 MB/s</b>');
    expect(big).toContain('eta <b>1h 1m</b>');
    expect(big).not.toContain('GB/s');
    expect(big).not.toContain('KB/s');

    const whole = await renderJobs([job({ speedBps: 1024 * 1024, etaSeconds: 90 })]);
    expect(whole).toContain('<b>1 MB/s</b>');
    expect(whole).toContain('eta <b>1m 30s</b>');

    const fractional = await renderJobs([job({ speedBps: 1.5 * 1024 * 1024 })]);
    expect(fractional).toContain('<b>1.5 MB/s</b>');
  });

  it('keeps the button a press landed on when the next poll rebuilds the row', async () => {
    // The browser sends a click to the nearest node both the press and the
    // release touched. Rebuilding the list between them used to leave the press
    // on a detached node, so the click landed on the row and the button did
    // nothing. Here a poll runs between the two, as the 600 ms timer does.
    const { window } = new JSDOM(html, { url: 'http://127.0.0.1:9999/__jobs?t=page-token' });
    const meta = { port: 8787, platform: 'win32', uptimeSeconds: 3660, activeCount: 1 };
    let poll = () => {};
    const posts: string[] = [];
    const fetch = async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') posts.push(url);
      return { json: async () => (url === '/api/fs/jobs' ? [job()] : meta) };
    };
    new Function('document', 'fetch', 'setInterval', 'location', 'URLSearchParams', pageScript())(
      window.document,
      fetch,
      (callback: () => void) => {
        poll = callback;
        return 0;
      },
      window.location,
      window.URLSearchParams,
    );
    const flush = async () => {
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    };
    await flush();

    const pressed = window.document.querySelector('button[data-act]');
    pressed?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    poll();
    await flush();

    const released = window.document.querySelector('button[data-act]');
    expect(released).toBe(pressed);
    released?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(posts).toEqual(['/api/fs/job/job-1/pause']);
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
