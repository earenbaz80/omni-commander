/**
 * The address of the engine page, as the tray hands it to the browser.
 *
 * It lives apart from the menu so its shape can be checked without Electron. The
 * page is opened by a navigation, which cannot carry the token as a header, so
 * the token travels in the query -- and only there: the port belongs to the
 * authority, the page to the path, and nothing else is added.
 */
function dashboardUrl(port, token) {
  if (port == null) return null;
  return `http://127.0.0.1:${port}/__jobs?t=${encodeURIComponent(token)}`;
}

module.exports = { dashboardUrl };
