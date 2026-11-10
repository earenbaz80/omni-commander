/**
 * How long a spec waits for the app to paint its first rows.
 *
 * The wait has to outlast the app's own retry budget, or a slow boot reads as a
 * broken app. Every call to the local server goes through `fetchWithRetry` with
 * `timeoutMs: 10000` and `retries: 2`: three attempts of ten seconds plus the
 * 500 ms and 1 s backoffs, which is 31.5 s for one request. Booting chains two of
 * them — the drive list, then the listing of the folder the panel opens — so a
 * boot that spends its retries answers after 63 s.
 *
 * The gate used to be 60 s, three seconds short of that worst case, and a master
 * run paid for it: in run 42761218207 (`8dac451`, 2026-11-10) the
 * window-grouping audit waited 60.0 s on `[data-name]`, timed out, and passed
 * 13.6 s later on the retry. Nothing was broken; the app was still retrying.
 *
 * 90 s leaves 27 s on top of the budget for the browser and a loaded runner, and
 * still fails a boot that is genuinely dead instead of hanging the suite.
 *
 * The number only buys that time if the case's own timeout sits above it:
 * Playwright's default is 30 s, so a 90 s gate inside a case that never raised
 * its timeout is cut short at 30 s and blames the assertion for a test-level
 * timeout. Cases that wait for the boot raise theirs with `test.setTimeout`.
 */
export const BOOT_TIMEOUT_MS = 90_000;
