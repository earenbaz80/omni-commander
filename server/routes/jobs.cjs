/**
 * Routes that describe and steer the transfer engine's jobs.
 *
 * They were the first block of the server because they only read `jobs`; the
 * engine that creates and runs those jobs stays in `server.cjs` for now, so this
 * module is handed what it needs instead of reaching for it. Nothing about the
 * HTTP contract changed: same paths, same methods, same answers.
 */

function registerJobRoutes(app, deps) {
  const { jobs, jobSnapshot, preferredPort, getActivePort } = deps;

  app.get('/api/fs/jobs', (_req, res) => {
    res.json([...jobs.values()].map(jobSnapshot));
  });

  app.get('/api/fs/dashboard', (_req, res) => {
    const all = [...jobs.values()];
    res.json({
      port: getActivePort() ?? preferredPort,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      activeCount: all.filter((j) => j.status === 'running' || j.status === 'paused').length,
      totalCount: all.length,
    });
  });

  app.get('/api/fs/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    res.json(jobSnapshot(job));
  });

  app.post('/api/fs/job/:id/:action', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    const action = req.params.action;
    if (action === 'resolve') {
      // Answer for one queued collision prompt. `applyToAll` promotes the answer
      // into the job policy so the rest of the transfer stops asking.
      const decision = String((req.body || {}).decision || '').toLowerCase();
      if (
        !['overwrite', 'skip', 'rename', 'overwrite-if-different', 'rename-old', 'resume', 'cancel'].includes(decision)
      ) {
        return res.status(400).json({ error: 'Unknown conflict answer' });
      }
      if (!job.pendingConflict) return res.status(409).json({ error: 'No pending conflict' });
      if (req.body && req.body.applyToAll) job.conflictOverride = decision;
      job.conflictDecision = decision;
      job.pendingConflict = null;
      return res.json(jobSnapshot(job));
    }
    if (action === 'pause') job.paused = true;
    else if (action === 'resume') job.paused = false;
    else if (action === 'cancel') {
      job.cancelled = true;
      job.paused = false;
    } else if (action === 'throttle') {
      // The copy loop re-reads job.throttleBps before every chunk, so the new
      // limit applies from the next write. 0 or below means unlimited.
      const bps = Number(req.body?.throttleBps);
      job.throttleBps = Number.isFinite(bps) && bps > 0 ? bps : 0;
    } else return res.status(400).json({ error: 'Unknown action' });
    res.json(jobSnapshot(job));
  });
}

module.exports = { registerJobRoutes };
