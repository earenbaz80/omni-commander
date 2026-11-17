/**
 * Drives, their cached metadata, the directory listing cache, and the routes
 * that answer "what is on this machine": drives, user folders, load, listing.
 *
 * It is a factory because the listing cache is shared: a finished transfer
 * clears it through the function this module returns, instead of the server
 * keeping a second reference to somebody else's Map. Volume enumeration itself
 * belongs to the platform adapter; this module only caches its listing work.
 */

const fs = require('fs');

const { createPlatform } = require('./platform/index.cjs');
const { requireCapability } = require('./platform/contract.cjs');

function createCatalog(deps = {}) {
  const {
    app,
    platform = createPlatform(),
    pathPolicy,
    readSystemStats,
    readElevation,
    readUserLibraries,
    fs: fsApi = fs,
  } = deps;
  const volumes = requireCapability(platform, 'volumes');
  const pathApi = requireCapability(platform, 'paths').pathApi;
  const windowsPaths = platform.id === 'win32';
  // The policy is the same object the routes use for path equality. A caller
  // that only builds a catalog in a test may omit it; the platform id is then
  // the fallback, never the Windows constant.
  const caseSensitive = pathPolicy ? pathPolicy.caseSensitive === true : platform.id !== 'win32';

  async function getRealDrives() {
    try {
      return await volumes.list();
    } catch {
      return [];
    }
  }

  function enrichDrivesFromWmi() {
    return volumes.warmUp();
  }

  function formatDt(date) {
    if (!date) return new Date().toISOString().replace('T', ' ').substring(0, 19);
    return new Date(date).toISOString().replace('T', ' ').substring(0, 19);
  }

  // Directory listing cache (short TTL) + parallel stat, so navigating back and
  // forth or listing from both panes doesn't re-read the disk every time.
  const listCache = new Map();
  const LIST_CACHE_MS = 2000;
  // Retention cap. The TTL only decides how fresh a cached listing is: without a
  // size bound, browsing hundreds of directories would keep every full listing for
  // the whole session, since entries are otherwise dropped only on error or write.
  const LIST_CACHE_LIMIT = 200;

  async function readDirectoryEntries(safePath) {
    const entries = await fsApi.promises.readdir(safePath, { withFileTypes: true });
    return Promise.all(
      entries.map(async (entry) => {
        const full = pathApi.join(safePath, entry.name);
        let stat = null;
        try {
          stat = await fsApi.promises.stat(full);
        } catch {}
        const isDirectory = entry.isDirectory();
        let ext = '';
        let name = entry.name;
        // Never split a directory name: a folder called "Python 3.11" must render
        // as "Python 3.11", not as "Python 3" plus extension "11". Dotfiles also
        // keep their whole name. `lastIndexOf` with an index > 0 handles names
        // like "file.tar.gz" and ".env.local" correctly.
        if (!isDirectory && !entry.name.startsWith('.')) {
          const dot = entry.name.lastIndexOf('.');
          if (dot > 0) {
            ext = entry.name.slice(dot + 1).toUpperCase();
            name = entry.name.slice(0, dot);
          }
        }
        return {
          name,
          ext,
          fullName: entry.name,
          isDirectory,
          size: stat && !isDirectory ? stat.size : 0,
          modifiedAt: formatDt(stat && stat.mtime),
          createdAt: formatDt(stat && stat.birthtime),
          attributes: {
            readOnly: !!stat && !(stat.mode & 0o200),
            hidden: entry.name.startsWith('.'),
            system: false,
            archive: !isDirectory,
          },
          content: '',
        };
      }),
    );
  }

  function readDirectoryCached(safePath) {
    // Windows paths compare without case; POSIX paths do not.
    const key = windowsPaths ? safePath.toUpperCase() : safePath;
    const now = Date.now();
    const cached = listCache.get(key);
    if (cached) {
      if (cached.inflight) return cached.inflight;
      if (cached.data && now - cached.at < LIST_CACHE_MS) return Promise.resolve(cached.data);
    }
    const inflight = readDirectoryEntries(safePath).then(
      (data) => {
        listCache.set(key, { at: Date.now(), data, inflight: null });
        pruneListCache();
        return data;
      },
      (err) => {
        listCache.delete(key);
        throw err;
      },
    );
    listCache.set(key, { at: now, data: null, inflight });
    pruneListCache();
    return inflight;
  }

  // Keeps the listing cache bounded in size. Map preserves insertion order, so the
  // oldest keys come first; in-flight reads are skipped because their promise owns
  // that entry and would otherwise be orphaned.
  function pruneListCache() {
    if (listCache.size <= LIST_CACHE_LIMIT) return;
    const excess = listCache.size - LIST_CACHE_LIMIT;
    let dropped = 0;
    for (const [key, entry] of listCache) {
      if (dropped >= excess) break;
      if (entry.inflight) continue;
      listCache.delete(key);
      dropped += 1;
    }
  }

  async function listDirectory(driveId, requestedPath) {
    const drives = await getRealDrives();
    const drive = drives.find((d) => d.id === driveId);
    if (!drive) return { error: 'Unknown drive' };

    let safePath;
    if (windowsPaths) {
      const root = `${drive.letter}\\`;
      const letterPattern = drive.letter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      let input = String(requestedPath || drive.letter).trim();
      let rel = input.replace(new RegExp(`^${letterPattern}`, 'i'), '').replace(/^[\\\/]+/, '');
      safePath = pathApi.join(drive.letter + '\\', rel || '.');

      // Safety: stay within the selected drive root.
      if (!safePath.toUpperCase().startsWith(root.toUpperCase())) {
        return { error: 'Path outside drive' };
      }
    } else {
      const root = pathApi.normalize(drive.letter || pathApi.sep);
      const input = String(requestedPath || root).trim();
      if (!pathApi.isAbsolute(input)) return { error: 'Path outside drive' };
      safePath = pathApi.normalize(input);
      const prefix = root.endsWith(pathApi.sep) ? root : root + pathApi.sep;
      if (safePath !== root && !safePath.startsWith(prefix)) {
        return { error: 'Path outside drive' };
      }
    }

    let items;
    try {
      items = await readDirectoryCached(safePath);
    } catch (err) {
      // A folder that is not there, or a file where a folder was asked for, is a
      // normal answer for a browser rather than a server fault. Saying 404 also
      // keeps the raw ENOENT text (and the server's own paths) out of the
      // response, and stops the client's 5xx retry from repeating a listing that
      // can only fail again.
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return { status: 404, error: `Folder not found: ${safePath}` };
      }
      // A folder that exists but is closed to this account (System Volume
      // Information, another user's profile) is not a server fault either, and
      // saying 500 made the caller report a dead server. 403 lets it say what
      // actually happened: the folder needs administrator rights.
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return { status: 403, error: `Folder not readable: ${safePath}` };
      }
      throw err;
    }
    return { path: safePath, items };
  }

  // What the renderer may assume about paths. Capabilities are sent as an
  // explicit boolean map so a Linux build names the features it still lacks
  // instead of letting the UI discover them through a failed call.
  app.get('/api/platform', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      platform: platform.id,
      caseSensitive,
      separator: pathApi.sep,
      capabilities: { ...platform.capabilities },
    });
  });

  app.get('/api/drives', async (_req, res) => {
    try {
      res.json(await getRealDrives());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // The folders Windows presents as libraries. They are per-profile, so a path
  // built from %USERPROFILE% is wrong whenever the user moved Desktop or Documents
  // into OneDrive: the resolution lives in readUserLibraries().
  app.get('/api/user-folders', async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await readUserLibraries());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Live system load: the CPU and RAM readings the info drawer shows
  // ---------------------------------------------------------------------------
  // The measurement itself lives in server/systemLoad.cjs, which explains why a
  // percentage needs two snapshots; this route only serves it.
  app.get('/api/system/stats', async (_req, res) => {
    try {
      // A live reading is worthless the moment it is cached.
      res.set('Cache-Control', 'no-store');
      // `elevated` is measured, not toggled: the interface used to switch an
      // "admin mode" on and off while nothing about the process changed.
      res.json({ ...(await readSystemStats()), elevated: await readElevation() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/list', async (req, res) => {
    try {
      const result = await listDirectory(String(req.query.driveId || ''), String(req.query.path || ''));
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json(result.items);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // What the command bar reports about this machine
  //
  // `ipconfig` and `tasklist` used to print canned text: a fixed 192.168.1.150
  // adapter and a process table that described no running process, and `tree`
  // printed four invented folder names. A shell that answers with invented output
  // is worse than one that refuses, because the user reads it as a measurement of
  // their own machine. Each of these now reports what it actually measured, and
  // fails loudly when it cannot.
  // ---------------------------------------------------------------------------
  // `tasklist` answers in about a second on an idle desktop and has been measured
  // past 25 s on a loaded one, so the budget is wide: a slow read is not a failed
  // read. Sixty seconds was measured too tight: on this machine, with the E2E
  // suite running beside it, the same call went past a minute twice and the shell
  // reported "Command failed" while the process list was still being read. The
  // first read after a quiet period is the slow one -- measured at 38 s on an
  // otherwise idle box and past two minutes under the suite's load -- so the
  // budget has to cover that cold read, not the warm ones around it.

  function clearListCache() {
    listCache.clear();
  }

  return { clearListCache, enrichDrivesFromWmi, listDirectory };
}

module.exports = { createCatalog };
