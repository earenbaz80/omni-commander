/**
 * Whether a failed check is GitHub having a bad minute, and when to try again.
 *
 * The feed is a public GitHub repository, so a check can fail for reasons that
 * have nothing to do with the app: while 1.0.43 was being published the edge
 * answered 504 for `latest.yml` for the better part of half an hour, and an
 * installed copy during that window showed "no se pudo comprobar" until the
 * next timer six hours later — which is long enough to look broken.
 *
 * A 5xx is the one failure worth repeating on its own. A 404 is our own feed
 * being wrong and will say the same thing a minute later, and an offline
 * machine should not be woken up to fail again.
 *
 * It lives here, apart from main.cjs, so the decision can be tested without
 * launching Electron.
 */

const MAX_TRANSIENT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 5 * 60_000;

/**
 * A server-side failure, in the shapes the stack prints it: the provider wraps
 * it as `HttpError: 504`, electron-builder's downloader as `Response code 504
 * (Gateway Time-out)`, and a body that came back as an error page carries the
 * phrase without the code.
 */
const TRANSIENT_PATTERNS = [
  /HttpError:\s*5\d\d/i,
  /Response code\s+5\d\d/i,
  /HTTP\s*5\d\d/i,
  /status(?:Code)?["'\s:]+5\d\d/i,
  /Gateway Time-?out/i,
  /Bad Gateway/i,
  /Service Unavailable/i,
  /Internal Server Error/i,
];

function isTransientUpdateError(message) {
  const text = typeof message === 'string' ? message : '';
  if (!text) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * How long to wait before repeating a check that hit a transient failure, or
 * `null` when the attempts for this run are spent. Doubling from thirty seconds
 * keeps a short outage from turning into a request every few seconds, and the
 * whole ladder ends inside five minutes, well before anything looks stuck.
 */
function nextRetryDelay(attempt) {
  const previous = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  if (previous >= MAX_TRANSIENT_RETRIES) return null;
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** previous, RETRY_MAX_DELAY_MS);
}

module.exports = {
  MAX_TRANSIENT_RETRIES,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  isTransientUpdateError,
  nextRetryDelay,
};
