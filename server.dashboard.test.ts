// @vitest-environment node
import { ESLint } from 'eslint';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
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
            clearInterval: 'readonly',
            history: 'readonly',
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
  // No tree behind this host: the rows are read as text. The behaviour that needs
  // real nodes -- a press, a rebuild, then the release -- is checked in jsdom below.
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
    if (url === '/api/fs/jobs') return { ok: true, json: async () => jobs };
    if (url === '/api/fs/dashboard') return { ok: true, json: async () => meta };
    // A route the page made up rejects, and the slot check below then fails.
    throw new Error(`unexpected ${url}`);
  };
  // The page polls forever; the first pass is all this test needs.
  // A browser hands back a positive id; a stub returning 0 would look like
  // "no timer" to the page's own stop/start bookkeeping.
  const setInterval = () => 1;

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
  expect(clicks.length).toBeGreaterThan(0);
  const button = { dataset: { id: 'job-1', act: 'pause' } };
  for (const click of clicks)
    click({ target: { closest: (selector: string) => (selector.includes('data-act') ? button : null) } });
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

  /**
   * Runs the page as a browser would, with the poll timer handed back so a test
   * can step it: the page keeps its own nodes and listeners this way.
   */
  async function mountPage(
    jobsAnswer?: () => Promise<{ ok?: boolean; json: () => Promise<unknown> }>,
    start: { search?: string; cookie?: string } = {},
  ) {
    const search = start.search ?? '?t=page-token';
    const meta = { port: 8787, platform: 'win32', uptimeSeconds: 3660, activeCount: 1 };
    let poll = () => {};
    let started = 0;
    const posts: string[] = [];
    const bodies: Array<{ url: string; body?: string }> = [];
    const headers: Array<Record<string, string> | undefined> = [];
    const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      if (init?.method === 'POST') posts.push(url);
      if (init?.body) bodies.push({ url, body: init.body });
      headers.push(init?.headers);
      if (url === '/api/fs/jobs') return jobsAnswer ? jobsAnswer() : { ok: true, json: async () => [job()] };
      return { ok: true, json: async () => meta };
    };
    // The page runs inside the window, not in a function called by the test: its
    // globals are the window's, which is the only way to see it rewrite the address
    // bar or keep the token in the tab's storage.
    const { window } = new JSDOM(html, {
      url: `http://127.0.0.1:9999/__jobs${search}`,
      runScripts: 'dangerously',
      beforeParse(win: any) {
        win.fetch = fetch;
        win.setInterval = (callback: () => void) => {
          poll = callback;
          started += 1;
          return started;
        };
        if (start.cookie) win.document.cookie = `omni-page=${encodeURIComponent(start.cookie)}`;
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    return { window, poll: () => poll(), posts, bodies, headers, settle, startedPolls: () => started };
  }

  it('acts on the press, so a poll between press and release cannot swallow it', async () => {
    // Chromium drops the click when the pressed button is replaced before the
    // release, though pointerdown and pointerup both arrive: a click listener
    // lost the action whenever the poll repainted the row under the cursor.
    const { window, poll, posts, settle } = await mountPage();

    const pressed = window.document.querySelector('button[data-act]');
    pressed?.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    expect(posts).toEqual(['/api/fs/job/job-1/pause']);

    poll();
    await settle();
    const released = window.document.querySelector('button[data-act]');
    released?.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    // A pointer-born click must not repeat what the press already did.
    released?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(posts).toEqual(['/api/fs/job/job-1/pause']);

    // Nothing was pressed here: this is the click a keyboard produces.
    released?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(posts).toEqual(['/api/fs/job/job-1/pause', '/api/fs/job/job-1/pause']);
  });

  it('puts the focus back on the same action after a rebuild', async () => {
    // A row is replaced every 600 ms, and the focused button goes with it: a
    // keyboard user tabbed onto Pause would fall back to the top of the page
    // before they could press it.
    const { window, poll, settle } = await mountPage();
    const first = window.document.querySelector('button[data-act="pause"]') as HTMLElement;
    first.focus();

    poll();
    await settle();

    const again = window.document.querySelector('button[data-act="pause"]') as HTMLElement;
    expect(again).not.toBe(first);
    expect(window.document.activeElement).toBe(again);
  });

  it('takes the token out of the address bar and keeps polling with it', async () => {
    // The URL is the only thing a navigation can carry, but leaving the secret there
    // puts it in the history and in any screenshot of the window.
    const { window, headers } = await mountPage();
    expect(window.location.search).toBe('');
    expect(headers.some((sent) => sent?.['x-omni-token'] === 'page-token')).toBe(true);
  });

  it('polls with the token the visit left in a cookie when the URL has none', async () => {
    // The reload arrives with the address bar already rewritten by the first visit.
    const { window, headers } = await mountPage(undefined, { search: '', cookie: 'kept-token' });
    expect(window.location.search).toBe('');
    expect(headers.some((sent) => sent?.['x-omni-token'] === 'kept-token')).toBe(true);
  });

  it('says the engine is unreachable instead of leaving stale rows looking current', async () => {
    // A restart binds another port and mints another token, so a page left open
    // starts failing every request while its rows keep their old progress.
    let down = true;
    const { window, poll, settle } = await mountPage(async () =>
      down ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => [job({ label: 'Recovered' })] },
    );
    const link = window.document.getElementById('link') as HTMLElement;
    expect(link.textContent).toContain('Engine unreachable');
    // Nothing from the failed answer reached the list.
    expect(window.document.getElementById('jobs')?.textContent).toContain('Loading jobs');

    down = false;
    poll();
    await settle();
    expect(link.textContent).toBe('');
    expect(window.document.getElementById('jobs')?.textContent).toContain('Recovered');
  });

  it('stops the timer while the tab is hidden and catches up when it returns', async () => {
    const { window, settle, startedPolls } = await mountPage();
    const cleared = vi.spyOn(window, 'clearInterval');
    const visibility = (hidden: boolean) => {
      Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    };
    const polls = startedPolls();

    visibility(true);
    expect(cleared).toHaveBeenCalled();
    expect(startedPolls()).toBe(polls);

    // Coming back polls at once instead of waiting out the next tick.
    visibility(false);
    await settle();
    expect(startedPolls()).toBe(polls + 1);
    cleared.mockRestore();
  });

  it('shows the conflict prompt with the answers the engine accepts', async () => {
    const row = await renderJobs([
      job({
        status: 'waiting',
        pendingConflict: {
          source: 'C:\\copias\\foto.jpg',
          destination: 'D:\\respaldo\\foto.jpg',
          sourceSize: 1536,
          destinationSize: 512,
          identical: false,
        },
      }),
    ]);

    expect(row).toContain('Destination already exists');
    // Both sides of the collision, which the prompt has to name to be answerable.
    expect(row).toContain('C:\\copias\\foto.jpg');
    expect(row).toContain('D:\\respaldo\\foto.jpg');
    for (const decision of ['overwrite', 'skip', 'rename']) {
      expect(row).toContain(`data-resolve="${decision}" data-id="job-1"`);
    }
    // Both sizes are shown, so a stale copy is not guessed at from the name alone.
    expect(row).toContain('1.5 KB / 512 B');
    // A parked transfer can be cancelled; pausing it would mean nothing.
    expect(row).toContain('Cancel');
    expect(row).not.toContain('data-act="pause"');
  });

  it('answers a conflict from the page instead of waiting for the window', async () => {
    const { window, bodies, settle } = await mountPage(async () => ({
      ok: true,
      json: async () => [job({ status: 'waiting', pendingConflict: { destination: 'D:\\respaldo\\foto.jpg' } })],
    }));

    window.document
      .querySelector('button[data-resolve="skip"]')
      ?.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    await settle();

    expect(bodies).toEqual([
      { url: '/api/fs/job/job-1/resolve', body: JSON.stringify({ decision: 'skip', applyToAll: false }) },
    ]);
  });

  it('keeps an apply-to-all choice across the repaints before the answer', async () => {
    // The row is rebuilt every poll, so a checkbox that lived only in the DOM
    // would be cleared before the user could press the answer it belongs to.
    const { window, poll, bodies, settle } = await mountPage(async () => ({
      ok: true,
      json: async () => [job({ status: 'waiting', pendingConflict: { destination: 'D:\\respaldo\\foto.jpg' } })],
    }));
    const all = () => window.document.querySelector('input[data-all="job-1"]') as HTMLInputElement;
    all().checked = true;
    all().dispatchEvent(new window.Event('change', { bubbles: true }));

    poll();
    await settle();
    expect(all().checked).toBe(true);

    window.document
      .querySelector('button[data-resolve="overwrite"]')
      ?.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(bodies.map((sent) => JSON.parse(String(sent.body)))).toEqual([{ decision: 'overwrite', applyToAll: true }]);
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
