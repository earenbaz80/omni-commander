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
/** 64 MiB: what a caller that never asked for a size may pull at once. */
const DEFAULT_READ_BYTES_LIMIT = 64 * 1024 * 1024;

/**
 * The limit is settable so a test can cross it with a file of a few bytes; the
 * app never sets it. Read once, when this module is first required.
 */
const READ_BYTES_LIMIT = (() => {
  const configured = Number(process.env.OMNI_READ_BYTES_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_READ_BYTES_LIMIT;
})();

/**
 * How many times the write route asks Windows to finish a replacement, and how
 * long it waits first. Five attempts of 20, 40, 80 and 160 ms add up to 300 ms,
 * which is longer than the scan that caused the problem and shorter than a user
 * would notice.
 */
const RENAME_ATTEMPTS = 5;
const RENAME_FIRST_WAIT_MS = 20;
/** The codes Windows uses for "not now": a scanner, the indexer or a reader holds it. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Renames a file, retrying while the system says the target is busy.
 *
 * The replacement write lands under a temporary name and is then renamed over
 * the destination, which is what keeps a failure from leaving a half-written
 * file. On Windows that final rename is the racy part: an antivirus scan, the
 * search indexer or another process reading the destination can hold it for a
 * few milliseconds and answer EPERM, and the write was already successful by
 * then. Redoing it costs nothing -- the bytes are in the temporary -- so it is
 * retried a few times with a growing pause instead of failing the extraction.
 *
 * Returns the attempt that worked, and takes its `fs` as an argument so a test
 * can drive it without a real lock.
 */
async function renameWithRetry(fs, source, target, options = {}) {
  const attempts = options.attempts ?? RENAME_ATTEMPTS;
  const firstWait = options.firstWaitMs ?? RENAME_FIRST_WAIT_MS;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let pause = firstWait;
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.promises.rename(source, target);
      return attempt;
    } catch (err) {
      if (!RENAME_RETRY_CODES.has(err.code) || attempt >= attempts) throw err;
      await wait(pause);
      pause *= 2;
    }
  }
}

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
        if (req.query.overwrite === '1') {
          // An answered conflict: the name is meant to be replaced, but the write
          // still lands under a temporary name first, so a failure leaves the
          // file that was there whole instead of half written.
          const temporary = `${target}.${Date.now().toString(36)}.part`;
          try {
            await fs.promises.writeFile(temporary, req.body, { flag: 'wx' });
            // The last step is the one a scanner can block for a moment; see
            // `renameWithRetry`.
            await renameWithRetry(fs, temporary, target);
          } catch (err) {
            await fs.promises.rm(temporary, { force: true }).catch(() => {});
            throw err;
          }
        } else {
          await fs.promises.writeFile(target, req.body, { flag: 'wx' });
        }
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
  //
  // The last-write time goes out in epoch milliseconds, the same unit the rest of
  // the app compares dates in. The conflict prompt shows it next to the archive
  // member's own date, and a size alone cannot tell an older file from a newer
  // one; without it that row read "—" and the user chose blind.
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
        modified: stat.mtimeMs,
      });
    }

    res.json({ entries, missing });
  });
  /**
   * Reads a file for the renderer. Three callers, three intents:
   *
   * - `maxBytes` is a preview: the viewer and the editor ask for a little more
   *   than they show, and get exactly that much of a long file (truncation is
   *   the point, so it is never an error).
   * - `unlimited` is the archive engine, which has to parse the file end to end.
   * - neither means "the whole file, if it is a file": past the limit that is a
   *   413 with the numbers, because the alternative -- what this route used to
   *   do -- is pulling a multi-gigabyte ISO into the server's memory for a caller
   *   that forgot to say how much it needed.
   */
  app.post('/api/fs/read-bytes', async (req, res) => {
    try {
      const body = req.body || {};
      const target = assertSafePath(body.path);
      const maxBytes = Number(body.maxBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0) {
        const wanted = Math.min(Math.floor(maxBytes), READ_BYTES_LIMIT);
        const handle = await fs.promises.open(target, 'r');
        try {
          const buffer = Buffer.alloc(wanted);
          const { bytesRead } = await handle.read(buffer, 0, wanted, 0);
          res.type('application/octet-stream').send(buffer.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
        return;
      }
      if (body.unlimited !== true) {
        const stat = await fs.promises.stat(target);
        if (!stat.isFile()) throw new Error('Not a file');
        if (stat.size > READ_BYTES_LIMIT) {
          res.status(413).json({
            error: `File is too large to read (${stat.size} bytes, limit ${READ_BYTES_LIMIT})`,
            size: stat.size,
            limit: READ_BYTES_LIMIT,
          });
          return;
        }
      }
      const bytes = await fs.promises.readFile(target);
      res.type('application/octet-stream').send(bytes);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

module.exports = { registerFileRoutes, renameWithRetry };
