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

/**
 * The attribution pages the offline map shows. OpenStreetMap's licence asks for
 * them to be reachable, and each layer carries its own `licenseUrl`, so the map
 * cannot work while the filter only knows the token page. Listed host by host
 * rather than "any https": the filter is still the boundary, and a new layer
 * that points somewhere else has to be added here on purpose.
 */
const LICENSE_PAGES = [
  { origin: 'https://www.openstreetmap.org', path: '/copyright' },
  { origin: 'https://www.hotosm.org', path: '/' },
  { origin: 'https://www.cyclosm.org', path: '/' },
  { origin: 'https://opentopomap.org', path: '/about' },
  { origin: 'https://memomaps.de', path: '/' },
];

/** True for one of those pages: same origin and the path it names or under it. */
function isLicensePage(parsed) {
  return LICENSE_PAGES.some((page) => {
    if (`${parsed.protocol}//${parsed.host}` !== page.origin) return false;
    if (page.path === '/') return true;
    return parsed.pathname === page.path || parsed.pathname.startsWith(`${page.path}/`);
  });
}

/** True only for the token page and the attribution pages, always over https. */
function isAllowedExternalTarget(target) {
  if (typeof target !== 'string') return false;

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (isLicensePage(parsed)) return true;
  if (parsed.hostname !== 'github.com') return false;
  return parsed.pathname === TOKEN_PAGE_PATH || parsed.pathname.startsWith(`${TOKEN_PAGE_PATH}/`);
}

module.exports = { TOKEN_PAGE, TOKEN_PAGE_PATH, LICENSE_PAGES, isLicensePage, isAllowedExternalTarget };
