/**
 * Drives, their cached metadata, the directory listing cache, and the routes
 * that answer "what is on this machine": drives, user folders, load, listing.
 *
 * It is a factory because the listing cache is shared: a finished transfer
 * clears it through the function this module returns, instead of the server
 * keeping a second reference to somebody else's Map.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function createCatalog(deps = {}) {
  const {
    app,
    assertSafePath,
    readSystemStats,
    readElevation,
    readUserLibraries,
    logDebug,
    powershellTimeoutMs = 60000,
  } = deps;
  const POWERSHELL_TIMEOUT_MS = powershellTimeoutMs;

  function mapWin32DriveType(value) {
    switch (Number(value)) {
      case 2:
        return { type: 'usb', kind: 'removable' };
      case 3:
        return { type: 'local', kind: 'fixed' };
      case 4:
        return { type: 'network', kind: 'network' };
      case 5:
        return { type: 'usb', kind: 'optical' };
      case 6:
        return { type: 'ram', kind: 'ram' };
      default:
        return { type: 'local', kind: 'unknown' };
    }
  }

  function makeDrive(info) {
    const mapped = mapWin32DriveType(info.driveType);
    const letter = String(info.letter || '')
      .trim()
      .endsWith(':')
      ? String(info.letter).trim()
      : `${String(info.letter || '').trim()}:`;
    const volumeName = String(info.volumeName || '').trim() || `Unidad ${letter}`;
    return {
      id: `real_${letter.replace(/[^a-zA-Z0-9]/g, '')}`,
      letter,
      name: volumeName,
      type: mapped.type,
      driveKind: mapped.kind,
      fileSystem: info.fileSystem ? String(info.fileSystem) : undefined,
      serialNumber: info.serialNumber ? String(info.serialNumber) : undefined,
      totalBytes: Number(info.size) || 0,
      freeBytes: Number(info.free) || 0,
      description: `${volumeName} [${mapped.kind}] ${info.fileSystem ? `(${info.fileSystem})` : 'desconocido'}`.trim(),
      isMounted: info.isMounted !== false,
    };
  }

  let drivesCache = { at: 0, data: null, inflight: null };
  // Short TTL: the probe itself is only a stat per candidate letter, and the
  // client polls this endpoint so a USB stick plugged in later shows up fast.
  const DRIVES_CACHE_MS = 3000;
  // Optional, richer per-drive metadata (volume label, filesystem, serial, type)
  // discovered asynchronously via WMI. The filesystem probe below always provides
  // the drive list itself, so this is only enrichment.
  let drivesMeta = new Map();

  // Enumerating drives must never block a request: a WMI/CIM query can take
  // minutes on a cold or constrained machine. The fast path stats candidate roots
  // directly (no child process) and is enriched by a background WMI query.
  // Results are cached and concurrent calls are de-duplicated.
  async function getRealDrives() {
    const now = Date.now();
    if (drivesCache.data && now - drivesCache.at < DRIVES_CACHE_MS) {
      return drivesCache.data;
    }
    if (drivesCache.inflight) return drivesCache.inflight;
    drivesCache.inflight = (async () => {
      const data = await computeRealDrives();
      drivesCache = { at: Date.now(), data, inflight: null };
      return data;
    })();
    try {
      return await drivesCache.inflight;
    } catch {
      drivesCache.inflight = null;
      return [];
    }
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      if (timer.unref) timer.unref();
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(fallback);
        },
      );
    });
  }

  // Probe C:\ .. Z:\ with fs.stat/statfs only. No child process, so this stays in
  // the millisecond range even when the WMI/CIM service is cold.
  async function probeDriveLetters() {
    const roots = [];
    for (let code = 67; code <= 90; code++) {
      roots.push(String.fromCharCode(code) + ':\\');
    }
    const probed = await Promise.all(
      roots.map(async (root) => {
        try {
          const stat = await fs.promises.stat(root);
          if (!stat.isDirectory()) return null;
          let totalBytes = 0;
          let freeBytes = 0;
          try {
            const sf = await fs.promises.statfs(root);
            const blockSize = Number(sf.bsize) || 0;
            totalBytes = blockSize * (Number(sf.blocks) || 0);
            freeBytes = blockSize * (Number(sf.bavail != null ? sf.bavail : sf.bfree) || 0);
          } catch (error) {
            logDebug('statfs failed for', root, error?.message || error);
          }
          return { letter: root.slice(0, 2).toUpperCase(), totalBytes, freeBytes };
        } catch {
          return null;
        }
      }),
    );
    const drives = [];
    for (const found of probed) {
      if (!found) continue;
      const meta = drivesMeta.get(found.letter) || {};
      drives.push(
        makeDrive({
          letter: found.letter,
          volumeName: meta.volumeName,
          driveType: meta.driveType != null ? meta.driveType : 3,
          size: meta.size || found.totalBytes,
          free: meta.free || found.freeBytes,
          fileSystem: meta.fileSystem,
          serialNumber: meta.serialNumber,
        }),
      );
    }
    return drives;
  }

  // A mapped network drive keeps its letter while the server behind it is
  // unreachable: `fs.stat` fails, the probe drops the letter, and the drive used
  // to disappear from every list until it came back on its own. WMI still
  // reports it, so it is added as a drive that is not mounted and the tree
  // shows it dimmed instead of forgetting it.
  function withNetworkFromMeta(drives) {
    const seen = new Set(drives.map((drive) => drive.letter.toUpperCase()));
    const offline = [];
    for (const [letter, meta] of drivesMeta) {
      if (seen.has(letter)) continue;
      if (Number(meta.driveType) !== 4) continue;
      offline.push(makeDrive({ letter, ...meta, isMounted: false }));
    }
    return offline.length ? [...drives, ...offline] : drives;
  }

  function drivesFromMeta(meta) {
    const drives = [];
    for (const [letter, m] of meta) {
      drives.push(
        makeDrive({
          letter,
          volumeName: m.volumeName,
          driveType: m.driveType,
          size: m.size,
          free: m.free,
          fileSystem: m.fileSystem,
          serialNumber: m.serialNumber,
          isMounted: Number(m.driveType) !== 4,
        }),
      );
    }
    return drives;
  }

  // Best-effort WMI/CIM query bounded by a timeout, so a cold WMI service can
  // never hang a request. Returns a Map keyed by upper-case drive letter.
  async function queryWmiDriveInfo() {
    const command =
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,Size,FreeSpace,FileSystem,VolumeSerialNumber | ConvertTo-Json -Compress';
    const { stdout: out } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: POWERSHELL_TIMEOUT_MS },
    );
    const parsed = JSON.parse((out || '').trim() || '[]');
    const entries = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const meta = new Map();
    for (const item of entries) {
      const letter = String(item.DeviceID || item.DeviceId || '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z]:$/.test(letter)) continue;
      meta.set(letter, {
        volumeName: item.VolumeName || item.Label,
        driveType: item.DriveType,
        size: item.Size,
        free: item.FreeSpace,
        fileSystem: item.FileSystem,
        serialNumber: item.VolumeSerialNumber,
      });
    }
    return meta;
  }

  // Runs the slow WMI query off the request path and merges its metadata into the
  // cached drive list once it resolves. One query at a time, so hot-plug polling
  // can never stack PowerShell spawns.
  let wmiInflight = false;
  // Letters a WMI refresh was already attempted for. Without this, a machine
  // where WMI permanently fails would spawn a fresh query on every drive probe.
  const wmiAttemptedLetters = new Set();

  async function enrichDrivesFromWmi() {
    if (process.platform !== 'win32' || wmiInflight) return;
    wmiInflight = true;
    try {
      const meta = await queryWmiDriveInfo();
      if (!meta.size) return;
      drivesMeta = meta;
      drivesCache = { at: 0, data: null, inflight: null };
    } catch (error) {
      // Keep the fast probe's generic metadata; the next new letter retries.
      logDebug('WMI drive enrichment failed:', error?.message || error);
    } finally {
      wmiInflight = false;
    }
  }

  // A probed letter the WMI snapshot has never seen means a device was just
  // plugged in: refresh the metadata in the background so it shows up with its
  // real volume label and drive type instead of the probe's generic defaults.
  function enrichForNewLetters(letters) {
    if (process.platform !== 'win32') return;
    const fresh = letters.filter((l) => !wmiAttemptedLetters.has(l) && !drivesMeta.has(l));
    if (!fresh.length) return;
    for (const letter of letters) wmiAttemptedLetters.add(letter);
    void enrichDrivesFromWmi();
  }

  async function computeRealDrives() {
    if (process.platform === 'win32') {
      const fast = await withTimeout(probeDriveLetters(), 8000, []);
      if (fast.length) {
        enrichForNewLetters(fast.map((d) => d.letter));
        return withNetworkFromMeta(fast);
      }
      // Fall back to WMI only when the filesystem probe found nothing at all.
      // Shares the inflight flag with the background warm-up so a slow WMI query
      // is never stacked on top of the one already running.
      try {
        if (!wmiInflight) {
          wmiInflight = true;
          try {
            const meta = await queryWmiDriveInfo();
            if (meta.size) {
              drivesMeta = meta;
              return drivesFromMeta(meta);
            }
          } finally {
            wmiInflight = false;
          }
        }
      } catch (error) {
        logDebug('WMI drive probe failed:', error?.message || error);
      }
      return [];
    }
    // Unix fallback
    try {
      const { stdout: out } = await execFileAsync('df', ['-kP'], { encoding: 'utf8' });
      const lines = out
        .split(/\r?\n/)
        .slice(1)
        .map((l) => l.trim())
        .filter(Boolean);
      const drives = [];
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
          const mapped = { type: 'local', kind: 'fixed' };
          drives.push({
            id: `real_${parts[5].replace(/[^a-zA-Z0-9]/g, '')}`,
            letter: parts[5],
            name: parts[0],
            type: mapped.type,
            driveKind: mapped.kind,
            fileSystem: parts[0],
            totalBytes: Number(parts[1]) * 1024,
            freeBytes: Number(parts[3]) * 1024,
            description: `Unidad [${mapped.kind}]`,
            isMounted: true,
          });
        }
      }
      return drives.length ? drives : [];
    } catch {
      return [];
    }
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
    const entries = await fs.promises.readdir(safePath, { withFileTypes: true });
    return Promise.all(
      entries.map(async (entry) => {
        const full = path.win32.join(safePath, entry.name);
        let stat = null;
        try {
          stat = await fs.promises.stat(full);
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
    const key = safePath.toUpperCase();
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

    const root = `${drive.letter}\\`;
    const letterPattern = drive.letter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    let input = String(requestedPath || drive.letter).trim();
    let rel = input.replace(new RegExp(`^${letterPattern}`, 'i'), '').replace(/^[\\\/]+/, '');
    const safePath = path.win32.join(drive.letter + '\\', rel || '.');

    // Safety: stay within the selected drive root.
    if (!safePath.toUpperCase().startsWith(root.toUpperCase())) {
      return { error: 'Path outside drive' };
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
