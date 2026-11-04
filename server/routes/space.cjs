/**
 * What a transfer asks the disk before it starts: is there room, what does a file
 * hash to, and can a batch list be saved for the next session.
 *
 * They left `server.cjs` together because they are the same kind of question --
 * each one is about a volume or a single file, needs a real disk to answer, and
 * still goes through the same path guard as everything else. Measuring a tree is
 * the job engine's walker, so it is passed in instead of duplicated here.
 */

function registerSpaceRoutes(app, deps) {
  const { fs, path, os, crypto, assertSafePath, measureTree, logDebug } = deps;

  // Pre-flight space check for a transfer that is about to start. The renderer
  // can neither measure a folder tree nor read a volume's free space, and a copy
  // that dies at 80% with ENOSPC leaves a half-written file behind. Trees are
  // measured with the same walker the job uses, so "Size" matches what the job
  // will report once it starts.
  //
  // Measuring is bounded on purpose. A batch list can carry 100 plans of 5000
  // sources, and walking all of them inside one request kept the answer minutes
  // away. The number of distinct sources walked per request is capped, repeated
  // sources are walked once, and the walks run a few at a time; a volume whose
  // sources were not all measured says so, because its size is then a lower
  // bound rather than the total.
  const PREFLIGHT_SOURCE_BUDGET = (() => {
    // Settable so a test can cross it with two files; the app never sets it.
    const configured = Number(process.env.OMNI_PREFLIGHT_SOURCE_BUDGET);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 10_000;
  })();
  const PREFLIGHT_CONCURRENCY = 8;

  app.post('/api/fs/freespace', async (req, res) => {
    try {
      const plans = (req.body || {}).plans;
      if (!Array.isArray(plans)) return res.status(400).json({ error: 'plans must be an array' });
      if (plans.length > 100) return res.status(400).json({ error: 'Too many plans (max 100)' });

      // A single transfer always writes to one target directory, but a loaded
      // copy list can span volumes. Group by volume root so the table has one
      // row per disk instead of one row per batch.
      const volumes = new Map();
      // Every charge is one occurrence of a source; the bytes it adds are the
      // same for all occurrences, but the walk behind them happens once.
      const charges = [];
      const distinct = new Map();

      for (const plan of plans) {
        const targetDir = assertSafePath(plan.targetDir);
        const root = path.win32.parse(targetDir).root.toUpperCase();
        if (!volumes.has(root)) {
          volumes.set(root, { volume: root, size: 0, free: null, lacking: 0, complete: true });
        }
        const group = volumes.get(root);
        const sources = Array.isArray(plan.sources) ? plan.sources.slice(0, 5000) : [];
        const op = String(plan.op || 'copy').toLowerCase() === 'move' ? 'move' : 'copy';
        for (const value of sources) {
          const source = assertSafePath(value);
          // A move inside one volume is a rename: no byte is written, so it needs
          // no room at all. Counting those bytes would refuse a transfer that
          // cannot possibly fill the disk.
          if (op === 'move' && path.win32.parse(source).root.toUpperCase() === root) continue;
          // Windows paths compare without case, and the same tree listed twice is
          // written twice, so it is charged twice but walked once.
          const key = source.toLowerCase();
          charges.push({ group, key });
          if (!distinct.has(key)) distinct.set(key, source);
        }
      }

      const keys = [...distinct.keys()];
      const measuredKeys = keys.slice(0, PREFLIGHT_SOURCE_BUDGET);
      if (keys.length > measuredKeys.length) {
        const measured = new Set(measuredKeys);
        for (const charge of charges) if (!measured.has(charge.key)) charge.group.complete = false;
      }

      const bytesBySource = new Map();
      let cursor = 0;
      const walk = async () => {
        while (cursor < measuredKeys.length) {
          const key = measuredKeys[cursor++];
          const measured = await measureTree(distinct.get(key));
          bytesBySource.set(key, measured.bytes);
        }
      };
      const workers = Math.min(PREFLIGHT_CONCURRENCY, measuredKeys.length);
      await Promise.all(Array.from({ length: workers }, walk));

      for (const charge of charges) {
        const bytes = bytesBySource.get(charge.key);
        if (bytes !== undefined) charge.group.size += bytes;
      }

      for (const group of volumes.values()) {
        try {
          const sf = await fs.promises.statfs(group.volume);
          const blockSize = Number(sf.bsize) || 0;
          group.free = blockSize * (Number(sf.bavail != null ? sf.bavail : sf.bfree) || 0);
          group.lacking = Math.max(0, group.size - group.free);
        } catch (error) {
          // An unreadable volume is not evidence of a problem: leave the answer
          // unknown instead of claiming the copy does not fit.
          logDebug('statfs failed for', group.volume, error?.message || error);
        }
      }

      res.json({ volumes: [...volumes.values()] });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Real byte hashes for a file on a real drive. The renderer cannot read the
  // bytes of a real file itself (they never come over /api/list), so it asks
  // here instead of hashing the metadata string it does have -- a digest that
  // must match the file's contents is worthless if it is computed from
  // name/size/mtime. Path validation mirrors the other fs routes, and this
  // route is gated by both the origin check and the session token, since a
  // digest reveals what a file contains.
  app.get('/api/fs/hash', async (req, res) => {
    try {
      const target = assertSafePath(req.query.path);
      const stat = await fs.promises.stat(target).catch(() => null);
      if (!stat) return res.status(404).json({ error: 'File not found' });
      if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });

      const md5 = crypto.createHash('md5');
      const sha1 = crypto.createHash('sha1');
      const sha256 = crypto.createHash('sha256');
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(target, { highWaterMark: 1024 * 1024 });
        // Permanent error binding for the whole read, so an unreadable or
        // interrupted stream rejects this request instead of crashing the
        // process on an unhandled 'error' event.
        stream.on('error', reject);
        stream.on('data', (chunk) => {
          md5.update(chunk);
          sha1.update(chunk);
          sha256.update(chunk);
        });
        stream.on('end', resolve);
      });

      res.json({
        path: target,
        size: stat.size,
        md5: md5.digest('hex'),
        sha1: sha1.digest('hex'),
        sha256: sha256.digest('hex'),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Copy list -----------------------------------------------------------
  // A SuperCopier-style transfer list persisted on real disk, so a batch of
  // transfers can be queued again in a later session. The default location is
  // per-user; an explicit absolute path is accepted for named lists.
  const defaultCopyListPath = () => path.join(os.homedir(), '.omnicommander', 'copy-list.json');
  const resolveCopyListPath = (value) => (value ? assertSafePath(value) : defaultCopyListPath());

  app.post('/api/fs/copylist/save', async (req, res) => {
    try {
      const body = req.body || {};
      const target = resolveCopyListPath(body.path);
      if (!Array.isArray(body.list)) {
        return res.status(400).json({ error: 'The copy list must be an array' });
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const payload = {
        version: 1,
        kind: 'omnicommander-copy-list',
        savedAt: new Date().toISOString(),
        list: body.list,
      };
      await fs.promises.writeFile(target, JSON.stringify(payload, null, 2), 'utf8');
      res.json({ ok: true, path: target, saved: body.list.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/copylist/load', async (req, res) => {
    try {
      const target = resolveCopyListPath((req.body || {}).path);
      const raw = await fs.promises.readFile(target, 'utf8').catch(() => null);
      if (raw === null) return res.json({ ok: true, path: target, list: [], found: false });
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'The copy list file is not valid JSON' });
      }
      const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.list) ? parsed.list : null;
      if (!list) return res.status(400).json({ error: 'The copy list file has no transfer list' });
      res.json({ ok: true, path: target, list, found: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

module.exports = { registerSpaceRoutes };
