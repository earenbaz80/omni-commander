const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const app = express();

// Allow cross-origin requests from the packaged Electron renderer (file:// origin).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});
const PORT = process.env.PORT || 3001;

function mapWin32DriveType(value) {
  switch (Number(value)) {
    case 2: return { type: 'usb', kind: 'removable' };
    case 3: return { type: 'local', kind: 'fixed' };
    case 4: return { type: 'network', kind: 'network' };
    case 5: return { type: 'usb', kind: 'optical' };
    case 6: return { type: 'ram', kind: 'ram' };
    default: return { type: 'local', kind: 'unknown' };
  }
}

function makeDrive(info) {
  const mapped = mapWin32DriveType(info.driveType);
  const letter = String(info.letter || '').trim().endsWith(':') ? String(info.letter).trim() : `${String(info.letter || '').trim()}:`;
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
    isMounted: true
  };
}

let drivesCache = { at: 0, data: null, inflight: null };
const DRIVES_CACHE_MS = 30000;
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
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); }
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
  const probed = await Promise.all(roots.map(async (root) => {
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
      } catch {}
      return { letter: root.slice(0, 2).toUpperCase(), totalBytes, freeBytes };
    } catch {
      return null;
    }
  }));
  const drives = [];
  for (const found of probed) {
    if (!found) continue;
    const meta = drivesMeta.get(found.letter) || {};
    drives.push(makeDrive({
      letter: found.letter,
      volumeName: meta.volumeName,
      driveType: meta.driveType != null ? meta.driveType : 3,
      size: meta.size || found.totalBytes,
      free: meta.free || found.freeBytes,
      fileSystem: meta.fileSystem,
      serialNumber: meta.serialNumber
    }));
  }
  return drives;
}

function drivesFromMeta(meta) {
  const drives = [];
  for (const [letter, m] of meta) {
    drives.push(makeDrive({
      letter,
      volumeName: m.volumeName,
      driveType: m.driveType,
      size: m.size,
      free: m.free,
      fileSystem: m.fileSystem,
      serialNumber: m.serialNumber
    }));
  }
  return drives;
}

// Best-effort WMI/CIM query bounded by a timeout, so a cold WMI service can
// never hang a request. Returns a Map keyed by upper-case drive letter.
async function queryWmiDriveInfo() {
  const command = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,Size,FreeSpace,FileSystem,VolumeSerialNumber | ConvertTo-Json -Compress';
  const { stdout: out } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60000 }
  );
  const parsed = JSON.parse((out || '').trim() || '[]');
  const entries = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  const meta = new Map();
  for (const item of entries) {
    const letter = String(item.DeviceID || item.DeviceId || '').trim().toUpperCase();
    if (!/^[A-Z]:$/.test(letter)) continue;
    meta.set(letter, {
      volumeName: item.VolumeName || item.Label,
      driveType: item.DriveType,
      size: item.Size,
      free: item.FreeSpace,
      fileSystem: item.FileSystem,
      serialNumber: item.VolumeSerialNumber
    });
  }
  return meta;
}

// Runs the slow WMI query off the request path and merges its metadata into the
// cached drive list once it resolves.
async function enrichDrivesFromWmi() {
  if (process.platform !== 'win32') return;
  try {
    const meta = await queryWmiDriveInfo();
    if (!meta.size) return;
    drivesMeta = meta;
    drivesCache = { at: 0, data: null, inflight: null };
  } catch {}
}

async function computeRealDrives() {
  if (process.platform === 'win32') {
    const fast = await withTimeout(probeDriveLetters(), 8000, []);
    if (fast.length) return fast;
    // Fall back to WMI only when the filesystem probe found nothing at all.
    try {
      const meta = await queryWmiDriveInfo();
      if (meta.size) {
        drivesMeta = meta;
        return drivesFromMeta(meta);
      }
    } catch {}
    return [];
  }
  // Unix fallback
  try {
    const { stdout: out } = await execFileAsync('df', ['-kP'], { encoding: 'utf8' });
    const lines = out.split(/\r?\n/).slice(1).map(l => l.trim()).filter(Boolean);
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
          isMounted: true
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

async function readDirectoryEntries(safePath) {
  const entries = await fs.promises.readdir(safePath, { withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const full = path.win32.join(safePath, entry.name);
      let stat = null;
      try { stat = await fs.promises.stat(full); } catch {}
      const isDirectory = entry.isDirectory();
      let ext = '';
      let name = entry.name;
      if (!entry.name.startsWith('.')) {
        const parts = entry.name.split('.');
        if (parts.length > 1) {
          ext = parts.pop().toUpperCase();
          name = parts.join('.');
        }
      }
      return {
        name,
        ext,
        isDirectory,
        size: stat && !isDirectory ? stat.size : 0,
        modifiedAt: formatDt(stat && stat.mtime),
        createdAt: formatDt(stat && stat.birthtime),
        attributes: { readOnly: !!stat && !(stat.mode & 0o200), hidden: entry.name.startsWith('.'), system: false, archive: !isDirectory },
        content: ''
      };
    })
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
    (data) => { listCache.set(key, { at: Date.now(), data, inflight: null }); return data; },
    (err) => { listCache.delete(key); throw err; }
  );
  listCache.set(key, { at: now, data: null, inflight });
  return inflight;
}

async function listDirectory(driveId, requestedPath) {
  const drives = await getRealDrives();
  const drive = drives.find(d => d.id === driveId);
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

  const items = await readDirectoryCached(safePath);
  return { path: safePath, items };
}

app.get('/api/drives', async (_req, res) => {
  try {
    res.json(await getRealDrives());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/list', async (req, res) => {
  try {
    const result = await listDirectory(String(req.query.driveId || ''), String(req.query.path || ''));
    if (result.error) return res.status(400).json(result);
    res.json(result.items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Optional static serving
app.use(express.static(path.join(__dirname, 'dist')));

// Warm the drive metadata cache in the background. Never blocks a request.
enrichDrivesFromWmi();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`REA/local drive server listening on http://localhost:${PORT}`);
});