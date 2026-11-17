/**
 * Windows volume enumeration, behind the platform contract.
 *
 * The fast path only stats candidate drive roots; WMI runs in the background
 * and enriches the cached list with labels, filesystem names, serial numbers and
 * mapped network drives. The cache and the single-flight guard live here, so a
 * caller never stacks PowerShell probes while a USB stick is being polled.
 */

const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

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

function createWindowsVolumes(options = {}) {
  const fsApi = options.fs || fs;
  const run = options.execFileAsync || execFileAsync;
  const logDebug = options.logDebug || (() => {});
  const powershellTimeoutMs = Number(options.powershellTimeoutMs) > 0 ? Number(options.powershellTimeoutMs) : 60000;

  let drivesCache = { at: 0, data: null, inflight: null };
  // Short TTL: the probe itself is only a stat per candidate letter, and the
  // client polls this endpoint so a USB stick plugged in later shows up fast.
  const DRIVES_CACHE_MS = 3000;
  // Optional, richer per-drive metadata (volume label, filesystem, serial, type)
  // discovered asynchronously via WMI. The filesystem probe always provides the
  // drive list itself, so this is only enrichment.
  let drivesMeta = new Map();
  // Mapped drives have a table of their own, and it is the only place that keeps
  // a letter whose server is unreachable: Win32_LogicalDisk may report the
  // mapping with no size, or not at all, and the probe drops the letter because
  // its root cannot be stat'ed. Reading the mapping table keeps that drive on
  // the list, dimmed, instead of letting it vanish until the share answers.
  let networkMeta = new Map();

  async function list() {
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

  // Probe C:\ .. Z:\ with fs.stat/statfs only. No child process, so this stays
  // in the millisecond range even when the WMI/CIM service is cold.
  async function probeDriveLetters() {
    const roots = [];
    for (let code = 67; code <= 90; code++) {
      roots.push(String.fromCharCode(code) + ':\\');
    }
    const probed = await Promise.all(
      roots.map(async (root) => {
        try {
          const stat = await fsApi.promises.stat(root);
          if (!stat.isDirectory()) return null;
          let totalBytes = 0;
          let freeBytes = 0;
          try {
            const sf = await fsApi.promises.statfs(root);
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
      const mapping = networkMeta.get(found.letter);
      drives.push(
        makeDrive({
          letter: found.letter,
          volumeName: meta.volumeName || mapping?.remoteName,
          driveType: meta.driveType != null ? meta.driveType : mapping ? 4 : 3,
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
    // LogicalDisk and the mapping table overlap: merge them by letter first so a
    // disconnected share is listed once, with the remote name either source has.
    const offline = new Map();
    for (const [letter, meta] of drivesMeta) {
      if (Number(meta.driveType) === 4) offline.set(letter, { ...meta });
    }
    for (const [letter, mapping] of networkMeta) {
      const meta = offline.get(letter) || {};
      offline.set(letter, { ...meta, volumeName: meta.volumeName || mapping.remoteName });
    }
    const missing = [];
    for (const [letter, meta] of offline) {
      if (seen.has(letter)) continue;
      missing.push(makeDrive({ letter, ...meta, driveType: 4, isMounted: false }));
    }
    return missing.length ? [...drives, ...missing] : drives;
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

  // PowerShell's ConvertTo-Json emits an object instead of an array for a single
  // row, so both WMI queries normalise through this one helper.
  async function queryRows(command) {
    const { stdout } = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: powershellTimeoutMs },
    );
    const parsed = JSON.parse(String(stdout || '').trim() || '[]');
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  }

  // Best-effort WMI/CIM query bounded by a timeout, so a cold WMI service can
  // never hang a request. Returns a Map keyed by upper-case drive letter.
  async function queryWmiDriveInfo() {
    const command =
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,Size,FreeSpace,FileSystem,VolumeSerialNumber | ConvertTo-Json -Compress';
    const entries = await queryRows(command);
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

  async function queryMappedNetworkDrives() {
    const command =
      'Get-CimInstance Win32_NetworkConnection | Select-Object LocalName,RemoteName | ConvertTo-Json -Compress';
    const entries = await queryRows(command);
    const meta = new Map();
    for (const item of entries) {
      const letter = String(item.LocalName || '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z]:$/.test(letter)) continue;
      meta.set(letter, { remoteName: String(item.RemoteName || '').trim() });
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

  async function warmUp() {
    if (wmiInflight) return;
    wmiInflight = true;
    try {
      const meta = await queryWmiDriveInfo();
      let mapped = null;
      try {
        mapped = await queryMappedNetworkDrives();
      } catch (error) {
        // No mapping table is not the same as no mappings: keep the last one.
        logDebug('Mapped drive query failed:', error?.message || error);
      }
      if (mapped) networkMeta = mapped;
      if (meta.size) drivesMeta = meta;
      if (meta.size || (mapped && mapped.size)) {
        drivesCache = { at: 0, data: null, inflight: null };
      }
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
    const fresh = letters.filter((l) => !wmiAttemptedLetters.has(l) && !drivesMeta.has(l));
    if (!fresh.length) return;
    for (const letter of fresh) wmiAttemptedLetters.add(letter);
    void warmUp();
  }

  async function computeRealDrives() {
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
          for (const [letter, mapping] of networkMeta) {
            if (!meta.has(letter)) {
              meta.set(letter, { driveType: 4, volumeName: mapping.remoteName });
            }
          }
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

  return Object.freeze({ list, warmUp });
}

module.exports = { createWindowsVolumes };
