/**
 * Which links the window may hand to the operating system.
 *
 * The renderer runs in a sandbox and cannot navigate out of its own document,
 * so a link that must open in the real browser asks the main process instead.
 * That makes the main process the only way out, and an unchecked hand-off there
 * would turn the shell into a launcher for any URL a compromised renderer
 * produced. Only the page the settings actually point at is allowed.
 *
 * Compared with the parsed URL rather than a prefix: `https://github.com@evil.com`
 * starts with `https://github.com` and is a different host, which is the same
 * mistake the navigation guard had to close.
 *
 * Lives apart from main.cjs so it can be tested without launching Electron.
 */

/** The GitHub page that creates read-only tokens; the settings link opens it. */
const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens';
const TOKEN_PAGE_PATH = '/settings/personal-access-tokens';

/** True only for that page and the pages under it, over https on github.com. */
function isAllowedExternalTarget(target) {
  if (typeof target !== 'string') return false;

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return false;
  if (parsed.username || parsed.password) return false;
  return parsed.pathname === TOKEN_PAGE_PATH || parsed.pathname.startsWith(`${TOKEN_PAGE_PATH}/`);
}

module.exports = { TOKEN_PAGE, TOKEN_PAGE_PATH, isAllowedExternalTarget };
