import { configure } from '@testing-library/dom';

/**
 * Two environments are in play, and which one a file gets is a cost decision
 * rather than a matter of taste. Creating a jsdom window means loading its
 * module graph — 949 modules, several seconds on a cold process — and with
 * per-file isolation that happens once for every test file, because each one
 * gets a fresh module registry. A file that never reads `document` or `window`
 * has nothing to gain from it and starts with `// @vitest-environment node`
 * instead; the configuration is jsdom, so the default goes the other way.
 *
 * So when adding a test for a service, a parser, a script or a config: make it
 * node. Only component tests, and the few things that genuinely read the DOM
 * (measuring, theming, the preview builders), need the window.
 */

/**
 * That the window comes from jsdom is not an oversight either: happy-dom was
 * measured against it and turned down, so reaching for the faster one again
 * means reading this first.
 *
 * It is genuinely quicker — 1.6–1.9 s to load against 3–7 s here, ~10 ms to
 * open a window instead of 100–670 ms, and ~38 % off a batch of component
 * tests. What it costs is the truth about the DOM. It ships no default style
 * for `<u>`, so `getComputedStyle(<u>).display` comes back empty rather than
 * `inline`; `dom-accessibility-api` then joins the pieces with a space and the
 * menu bar's accessible name reads "I zquierda" instead of "Izquierda", because
 * HeaderMenuBar renders its access key as `<u>{letter}</u>`. Its localStorage
 * also never throws on quota, leaving the persist-failure path untested. Both
 * are the environment misreporting the document the browser would have given
 * us, which is the one thing these tests are here to check: on the full suite
 * it took 3 files and 5 tests red, and the honest repair would have been to
 * rewrite the accessible names to match a DOM no browser produces.
 */

/**
 * Default wait for `findBy*`, `findAllBy*` and `waitFor`, in milliseconds.
 *
 * Testing Library ships one second, which is a budget for the assertion rather
 * than for the computer running it. A modal that resolves a mocked read and
 * re-renders does not get slower because the element is missing: it gets slower
 * because the box is compiling, swapping or running three other suites, and then
 * the query fails with "Unable to find an element" even though the component is
 * fine. That is the failure this keeps out of the local run.
 *
 * It only changes how long a query waits, never what it accepts: a test that
 * expects an element which never appears still fails, five seconds later. The
 * tests themselves keep the default timeout for their own bodies, so a hang is
 * still reported as a hang.
 */
configure({ asyncUtilTimeout: 5000 });

/**
 * Console output from test files is recorded here instead of being forwarded.
 *
 * Vitest runs each file in a worker that sends `console.*` calls to the main
 * process over RPC. A call made while that worker is closing — a mocked fetch
 * rejecting after its test ended, a retry timer firing during teardown, the app
 * logging a failed drive load after unmount — leaves the RPC pending, and vitest
 * reports `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
 * pending`. The run then exits 1 with every test passing, which turns a slow
 * machine into a red build and teaches people to ignore the exit code.
 *
 * Nothing in this suite asserts on console output, so the methods are replaced
 * before any test file imports the app: no RPC exists to be pending. A test that
 * does want to check logging can still spy on these functions, and `vi.restoreAllMocks`
 * restores them rather than the real console, so the channel stays closed.
 *
 * Set `VITEST_CONSOLE=1` to keep the real console when debugging a file; the
 * teardown race can come back in that mode, which is the trade being made.
 */
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const;

if (process.env.VITEST_CONSOLE !== '1') {
  for (const method of CONSOLE_METHODS) {
    // Direct assignment, not `vi.spyOn`: suites that call `vi.restoreAllMocks`
    // in `afterEach` would otherwise reopen the channel mid-run.
    (console as unknown as Record<string, unknown>)[method] = () => {};
  }
}
