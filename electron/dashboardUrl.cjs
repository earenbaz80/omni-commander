/**
 * The address of the engine page, as the tray hands it to the browser.
 *
 * A navigation cannot carry the token as a header, so it travels in the query;
 * the port belongs to the authority and the page to the path.
 */
function dashboardUrl(port, token) {
  if (port == null) return null;
  return `http://127.0.0.1:${port}/__jobs?t=${encodeURIComponent(token)}`;
}

module.exports = { dashboardUrl };
