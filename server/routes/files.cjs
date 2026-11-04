/**
 * The file routes: create a folder, send an item somewhere, check which folders
 * still exist, rename, write and size.
 *
 * They share one trait, which is why they left together: none of them starts a job
 * or streams anything -- each answers about or touches a single path, and rejects
 * it before doing anything if the path is not one the server accepts. The helpers
 * that know how a path becomes a file (the archive guard, the "send to" folders,
 * the shortcut writer) stay in `server.cjs` and are passed in.
 */
function registerFileRoutes(app, deps) {
  const {
    fs,
    path,
    express,
    assertSafePath,
    assertArchiveDestination,
    invalidateListings,
    pathExists,
    assertFolder,
    sendToFolder,
    createShortcut,
    copyIntoFolder,
    uniqueName,
  } = deps;

  app.post('/api/fs/mkdir', async (req, res) => {
    try {
      const target = assertSafePath((req.body || {}).path);
      if (req.body.archiveRoot) await assertArchiveDestination(req.body.archiveRoot, target);
      await fs.promises.mkdir(target, { recursive: true });
      invalidateListings();
      res.json({ ok: true, path: target });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // "Enviar a": the desktop gets a shortcut, everything else gets a copy, which
  // is what the same menu does in Explorer. Either a known destination name or a
  // folder picked in the dialog; the server resolves the first and validates the
  // second, so nothing is written where the request did not point.
  app.post('/api/fs/sendto', async (req, res) => {
    try {
      const body = req.body || {};
      const target = assertSafePath(body.path);
      if (!(await pathExists(target))) return res.status(404).json({ error: 'The item no longer exists' });

      const pickedFolder = String(body.destinationDir || '').trim();
      const folder = pickedFolder ? await assertFolder(pickedFolder) : await sendToFolder(body.destination);

      if (!pickedFolder && body.destination === 'desktop') {
        // Explorer names these "<name> - Acceso directo.lnk", and a second one
        // for the same item gets a numbered sibling instead of replacing it.
        const wanted = `${path.win32.basename(target)} - Acceso directo.lnk`;
        const direct = path.win32.join(folder, wanted);
        const shortcutPath = (await pathExists(direct))
          ? path.win32.join(folder, await uniqueName(folder, wanted))
          : direct;
        await createShortcut(target, shortcutPath);
        invalidateListings();
        return res.json({ ok: true, kind: 'shortcut', path: shortcutPath });
      }

      const copyPath = await copyIntoFolder(target, folder);
      invalidateListings();
      res.json({ ok: true, kind: 'copy', path: copyPath });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Which of these folders still exist. The tree pins folders by path and has to
  // forget the ones deleted outside the app; a path that cannot be checked is
  // left out of the answer rather than reported as gone, so a permissions error
  // never prunes a favourite.
  app.post('/api/fs/exists', async (req, res) => {
    try {
      const body = req.body || {};
      const requested = Array.isArray(body.paths) ? body.paths.slice(0, 200) : [];
      const existing = [];
      const unchecked = [];
      for (const value of requested) {
        let candidate = '';
        try {
          candidate = assertSafePath(String(value || ''));
        } catch {
          // A path the server cannot even accept is reported separately, never as
          // deleted: the caller keeps what it could not verify.
          unchecked.push(String(value || ''));
          continue;
        }
        const stat = await fs.promises.stat(candidate).catch(() => null);
        if (stat && stat.isDirectory()) existing.push(candidate);
      }
      res.json({ existing, unchecked });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/rename', async (req, res) => {
    try {
      const body = req.body || {};
      const source = assertSafePath(body.path);
      const newName = String(body.newName || '').trim();
      if (!newName || /[\\/:*?"<>|]/.test(newName)) {
        return res.status(400).json({ error: 'Invalid file name' });
      }
      const dest = path.win32.join(path.win32.dirname(source), newName);
      if (await pathExists(dest)) return res.status(409).json({ error: 'A file with that name already exists' });
      await fs.promises.rename(source, dest);
      invalidateListings();
      res.json({ ok: true, path: dest });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post(
    '/api/fs/write-bytes',
    express.raw({ type: 'application/octet-stream', limit: '512mb' }),
    async (req, res) => {
      try {
        const target = assertSafePath(req.query.path);
        await assertArchiveDestination(req.query.root, target);
        await fs.promises.mkdir(path.win32.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, req.body, { flag: 'wx' });
        invalidateListings();
        res.json({ ok: true, path: target });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    },
  );

  app.post('/api/fs/write', async (req, res) => {
    try {
      const body = req.body || {};
      const target = assertSafePath(body.path);
      await fs.promises.mkdir(path.win32.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, body.content == null ? '' : String(body.content), 'utf8');
      invalidateListings();
      res.json({ ok: true, path: target });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Sizes paths that did not come from a directory listing, which today means
  // whatever the native picker returned. The renderer needs a real size to show
  // a transfer total and a real type to decide between one job call and a tree
  // walk, and it cannot stat anything itself. Folders report 0 bytes because the
  // transfer job measures them when it starts; walking every child here would
  // block the request on a folder like Program Files.
  app.post('/api/fs/stat', async (req, res) => {
    const requested = (req.body || {}).paths;
    if (!Array.isArray(requested)) return res.status(400).json({ error: 'paths must be an array' });
    if (requested.length > 500) return res.status(400).json({ error: 'Too many paths (max 500)' });

    const entries = [];
    const missing = [];
    for (const value of requested) {
      let target;
      try {
        target = assertSafePath(value);
      } catch (err) {
        missing.push({ path: String(value), reason: err.message });
        continue;
      }
      const stat = await fs.promises.stat(target).catch(() => null);
      if (!stat) {
        missing.push({ path: target, reason: 'not found' });
        continue;
      }
      entries.push({
        path: target,
        name: path.win32.basename(target),
        isDirectory: stat.isDirectory(),
        size: stat.isDirectory() ? 0 : stat.size,
      });
    }

    res.json({ entries, missing });
  });
}

module.exports = { registerFileRoutes };
