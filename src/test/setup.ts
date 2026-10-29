import { configure } from '@testing-library/dom';

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
