/**
 * The one filesystem call Windows makes racy, in one place.
 *
 * A replacement write lands under a temporary name and is renamed over the
 * destination, and a same-volume move is a rename too. That final rename is what
 * Windows refuses with EPERM while an antivirus scan, the search indexer or a
 * reader holds the name for a few milliseconds -- even though the write already
 * succeeded and the same call would work on the next try.
 *
 * Only those "not now" codes are retried. A missing file, an invalid name or a
 * real denial is final, so it is thrown on the first try instead of making the
 * user wait for attempts that cannot change the answer.
 */

/** Five attempts of 20, 40, 80 and 160 ms add up to 300 ms: longer than the lock. */
const RENAME_ATTEMPTS = 5;
const RENAME_FIRST_WAIT_MS = 20;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Renames a file, retrying while the system says the name is busy.
 *
 * Takes its `fs` and its wait function as arguments so a test can drive it
 * without a real lock, and returns the attempt that worked.
 */
async function renameWithRetry(fs, source, target, options = {}) {
  const attempts = options.attempts ?? RENAME_ATTEMPTS;
  const firstWait = options.firstWaitMs ?? RENAME_FIRST_WAIT_MS;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let pause = firstWait;
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.promises.rename(source, target);
      return attempt;
    } catch (err) {
      if (!RENAME_RETRY_CODES.has(err.code) || attempt >= attempts) throw err;
      await wait(pause);
      pause *= 2;
    }
  }
}

module.exports = { renameWithRetry, RENAME_ATTEMPTS, RENAME_FIRST_WAIT_MS, RENAME_RETRY_CODES };
