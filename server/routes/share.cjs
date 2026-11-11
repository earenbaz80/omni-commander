/**
 * The app's side of network sharing: what the panel asks, and the only place a
 * share is started or stopped.
 *
 * These routes are mounted on the loopback listener, so the LAN listener itself
 * never accepts a command. Starting one is a POST, which already needs the
 * per-launch session token, and the status GET joins the sensitive reads because
 * it names a folder on this disk and hands out the share token.
 */
function registerShareRoutes(app, { share }) {
  app.get('/api/share', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(share.status());
  });

  app.post('/api/share/start', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const status = await share.start({ folder: body.folder, port: body.port });
      response.json(status);
    } catch (error) {
      // A folder that is not there, or one that is not a local path, is the
      // user's answer to fix rather than a server fault.
      response.status(400).json({ error: error && error.message ? error.message : String(error) });
    }
  });

  app.post('/api/share/stop', (_request, response) => {
    share.stop();
    response.json(share.status());
  });
}

module.exports = { registerShareRoutes };
