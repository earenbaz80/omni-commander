/**
 * Transfers and cleanup: the routes that create and drive real filesystem work.
 *
 * The queue stays in `server.cjs` -- it owns the job factory, the pauses and the
 * copy loop -- so it is passed in along with the deletion helpers and the cleanup
 * scan. What moved is the HTTP surface: same paths, same methods, same answers,
 * which is why the suites that boot the real server did not have to change.
 */
const { isDriveRoot } = require('../pathSafety.cjs');
const { appendLog } = require('../scratch.cjs');

function registerTransferRoutes(app, deps) {
  const {
    fs,
    assertSafePath,
    makeJob,
    startJob,
    waitWhilePaused,
    runTransferJob,
    noteFile,
    deleteTarget,
    invalidateListings,
    logRejected,
    CLEANUP_TARGETS,
    cleanupTargetPath,
    resolveCleanupRoot,
    clampCleanupDays,
    scanCleanup,
    runCleanup,
  } = deps;

  /**
   * One line for the transfer route itself, in the same diary the copy engine
   * writes. An accepted request and the job it becomes then read as one story,
   * and a refused one leaves more than the JSON rejection log behind: without
   * this, a copy that never reached the loop was indistinguishable from one
   * that was never asked for.
   */
  function noteJob(...parts) {
    appendLog('omnicommander-job.log', `${new Date().toISOString()} ${parts.join(' ')}`);
  }

  const transfer = (op) => async (req, res) => {
    try {
      const body = req.body || {};
      const sources = (body.sources || []).map(assertSafePath);
      // Moving a volume root would copy the whole drive and then delete its
      // origin; the destination may still be a root, which is just a folder.
      if (op === 'move') {
        for (const src of sources) {
          if (isDriveRoot(src)) throw new Error(`Refusing to move a drive root: ${src}`);
        }
      }
      const targetDir = assertSafePath(body.targetDir);
      if (!sources.length) throw new Error('No sources provided');
      const targetStat = await fs.promises.stat(targetDir).catch(() => null);
      if (!targetStat || !targetStat.isDirectory()) {
        // Name both forms: the normalized path that was checked and the raw
        // value the client sent, so a stale panel path is obvious at a glance.
        throw new Error(`Target is not a directory: ${targetDir} (received "${body.targetDir}")`);
      }
      for (const src of sources) {
        if (src.toUpperCase() === targetDir.toUpperCase()) {
          throw new Error(`Source and target are the same: ${src}`);
        }
      }
      const verb = op === 'move' ? 'Mover' : 'Copiar';
      const job = makeJob(op, `${verb} ${sources.length} elemento(s)`);
      const requestedPolicy = String(body.collision || '').toLowerCase();
      job.collision = ['overwrite', 'skip', 'rename', 'ask'].includes(requestedPolicy)
        ? requestedPolicy
        : body.overwrite === false
          ? 'rename'
          : 'overwrite';
      job.throttleBps = Number(body.throttleBps) > 0 ? Number(body.throttleBps) : 0;
      // A forced copy is the user's explicit answer to the numbers the
      // free-space prompt already showed. Carry it into the job so the guard
      // below records the overflow instead of refusing an approved transfer.
      job.force = body.force === true;
      // The client only needs the job id to start polling. Sizing the tree here
      // meant a large folder blocked the response until the walk finished, and
      // any client timeout turned a working transfer into "could not start".
      // The job measures itself once it is running; polling picks the total up.
      // Written down where the job log can see it: a request that arrives and
      // then never reaches the copy loop used to look exactly like a request
      // that never arrived, which is the difference between a client bug and a
      // server one.
      noteJob(op, `sources=${sources.length}`, `target=${targetDir}`, 'accepted');
      startJob(job, runTransferJob(job, sources, targetDir));
      res.json({ jobId: job.id, totalBytes: 0, itemsTotal: 0 });
    } catch (err) {
      logRejected(`/api/fs/${op}`, req.body, err);
      noteJob(op, `target=${String((req.body || {}).targetDir)}`, 'refused', err.message);
      res.status(400).json({ error: err.message });
    }
  };

  app.post('/api/fs/copy', transfer('copy'));
  app.post('/api/fs/move', transfer('move'));

  // Advertises the folders the cleanup menu may offer. Read-only: it reports the
  // resolved paths and which of them need an elevated token, and deletes nothing.
  app.post('/api/fs/cleanup/targets', (_req, res) => {
    const targets = Object.keys(CLEANUP_TARGETS).map((id) => {
      const folder = cleanupTargetPath(id);
      return {
        id,
        path: folder,
        requiresAdmin: CLEANUP_TARGETS[id].requiresAdmin,
        exists: !!folder && fs.existsSync(folder),
      };
    });
    res.json({ targets });
  });

  app.post('/api/fs/cleanup/scan', async (req, res) => {
    try {
      const body = req.body || {};
      const root = resolveCleanupRoot(String(body.target || ''));
      const minAgeDays = clampCleanupDays(body.minAgeDays);
      const scan = await scanCleanup(root, minAgeDays);
      res.json({
        target: String(body.target),
        path: root,
        minAgeDays,
        files: scan.files.length,
        dirs: scan.dirs.length,
        bytes: scan.bytes,
        skipped: scan.skipped,
        truncated: scan.truncated,
        largest: [...scan.files]
          .sort((a, b) => b.size - a.size)
          .slice(0, 8)
          .map((file) => ({ name: file.name, size: file.size, modifiedMs: file.modifiedMs })),
      });
    } catch (err) {
      logRejected('/api/fs/cleanup/scan', req.body, err);
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/cleanup/run', async (req, res) => {
    try {
      const body = req.body || {};
      const root = resolveCleanupRoot(String(body.target || ''));
      const minAgeDays = clampCleanupDays(body.minAgeDays);
      // The folder is re-walked here on purpose. The client sends a target and a
      // filter, never the list of files to delete, so this route cannot be
      // turned into a way to remove an arbitrary path.
      const result = await runCleanup(root, minAgeDays);
      invalidateListings();
      res.json({ target: String(body.target), path: root, minAgeDays, ...result });
    } catch (err) {
      logRejected('/api/fs/cleanup/run', req.body, err);
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/delete', (req, res) => {
    try {
      const body = req.body || {};
      const targets = (body.targets || []).map(assertSafePath);
      for (const target of targets) {
        if (isDriveRoot(target)) throw new Error(`Refusing to delete a drive root: ${target}`);
      }
      const useTrash = body.useTrash !== false;
      if (!targets.length) return res.status(400).json({ error: 'No targets provided' });
      const job = makeJob('delete', `Eliminar ${targets.length} elemento(s)`);
      job.itemsTotal = targets.length;
      startJob(
        job,
        (async () => {
          for (const target of targets) {
            await waitWhilePaused(job);
            let entry = null;
            try {
              const stat = await fs.promises.lstat(target).catch(() => null);
              entry = noteFile(job, target, stat && stat.isFile() ? stat.size : 0);
              await deleteTarget(target, useTrash);
              entry.copied = entry.size;
              entry.status = 'done';
              job.itemsDone += 1;
            } catch (err) {
              if (entry) entry.status = 'error';
              if (err.message === '__cancelled__') throw err;
              job.errors.push({ path: target, message: err.message });
            }
          }
        })(),
      );
      res.json({ jobId: job.id, itemsTotal: targets.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

module.exports = { registerTransferRoutes };
