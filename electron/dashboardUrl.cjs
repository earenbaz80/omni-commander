/**
 * The address of the engine page, as the tray hands it to the browser.
 *
 * A navigation cannot carry the token as a header, so it travels in the query;
 * the port belongs to the authority and the page to the path.
 */
function dashboardUrl(port, token, jobId) {
  if (port == null) return null;
  const url = `http://127.0.0.1:${port}/__jobs?t=${encodeURIComponent(token)}`;
  // A job id opens the page on that job's row, which is how the tray points at the
  // transfer that needs the user instead of dropping them at the top of the list.
  return jobId ? `${url}&job=${encodeURIComponent(jobId)}` : url;
}

module.exports = { dashboardUrl };
