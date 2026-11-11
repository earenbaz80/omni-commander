/**
 * What the built-in browser is allowed to load.
 *
 * The address bar takes what a person types, which is rarely a URL: "example.com"
 * or "localhost:3020". This turns that into something navigable and refuses
 * everything that is not http(s), so a pasted `javascript:`, `file://` or
 * `data:` never becomes a page inside the app.
 */

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/** Hosts a local web server would live on, which are reached over http. */
function isLocalHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** The host part of whatever was typed, before a scheme is added. */
function hostOf(text) {
  return text.split(/[/?#]/)[0].replace(/:\d+$/, '');
}

/**
 * A URL the view may load, or null when the input cannot become one.
 *
 * A scheme is only recognised with its `//`, because "localhost:3020" would
 * otherwise look like the scheme "localhost:". A bare host gets http when it is
 * a loopback or private address — that is where a local server listens — and
 * https everywhere else.
 */
function normalizeBrowserUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const candidate = hasScheme ? text : `${isLocalHostname(hostOf(text)) ? 'http' : 'https'}://${text}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) return null;
  return parsed.toString();
}

module.exports = { normalizeBrowserUrl, isLocalHostname };
