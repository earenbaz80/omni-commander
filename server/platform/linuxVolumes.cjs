/**
 * Linux volumes from the kernel's mount table.
 *
 * `/proc/self/mounts` is the source `df` and `findmnt` also read, and it is
 * already available in a minimal container. Pseudo filesystems are filtered
 * out so the drive bar shows mounts a file manager can browse, not `/proc` or
 * `/sys`. Labels and read-only flags are deliberately left to the later Linux
 * slice; this adapter only has to expose every real mount point with its free
 * space.
 */

const fs = require('node:fs');
const path = require('node:path');

const PSEUDO_FILESYSTEMS = new Set([
  'autofs',
  'binfmt_misc',
  'bpf',
  'cgroup',
  'cgroup2',
  'configfs',
  'debugfs',
  'devpts',
  'devtmpfs',
  'efivarfs',
  'fusectl',
  'hugetlbfs',
  'mqueue',
  'nsfs',
  'proc',
  'pstore',
  'rpc_pipefs',
  'securityfs',
  'sysfs',
  'tracefs',
]);

const NETWORK_FILESYSTEMS = new Set(['9p', 'afs', 'cifs', 'nfs', 'nfs4', 'smb3', 'sshfs']);

function decodeMountField(value) {
  return String(value).replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function volumeKind(fsType, mountPoint) {
  if (NETWORK_FILESYSTEMS.has(fsType)) return { type: 'network', kind: 'network' };
  if (fsType === 'iso9660' || fsType === 'udf') return { type: 'usb', kind: 'optical' };
  if (fsType === 'ramfs' || fsType === 'tmpfs') return { type: 'ram', kind: 'ram' };
  if (mountPoint.startsWith('/media/') || mountPoint.startsWith('/run/media/')) {
    return { type: 'usb', kind: 'removable' };
  }
  return { type: 'local', kind: 'fixed' };
}

function parseMounts(text) {
  const seen = new Set();
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3) continue;
    const [device, rawMountPoint, fsType] = fields;
    if (!device || !rawMountPoint || !fsType) continue;
    if (PSEUDO_FILESYSTEMS.has(fsType)) continue;
    const mountPoint = decodeMountField(rawMountPoint);
    if (!mountPoint.startsWith('/') || seen.has(mountPoint)) continue;
    seen.add(mountPoint);
    rows.push({ device: decodeMountField(device), mountPoint, fsType });
  }
  return rows;
}

function createLinuxVolumes(options = {}) {
  const fsApi = options.fs || fs;
  const mountsFile = options.mountsFile || '/proc/self/mounts';
  const readMounts = options.readMounts || (() => fsApi.promises.readFile(mountsFile, 'utf8'));
  const statfs = options.statfs || ((root) => fsApi.promises.statfs(root));
  const logDebug = options.logDebug || (() => {});

  async function list() {
    let text;
    try {
      text = await readMounts();
    } catch (error) {
      logDebug('Reading mounts failed:', error?.message || error);
      return [];
    }

    const rows = parseMounts(text);
    return Promise.all(
      rows.map(async ({ device, mountPoint, fsType }) => {
        let totalBytes = 0;
        let freeBytes = 0;
        try {
          const sf = await statfs(mountPoint);
          const blockSize = Number(sf.bsize) || 0;
          totalBytes = blockSize * (Number(sf.blocks) || 0);
          freeBytes = blockSize * (Number(sf.bavail != null ? sf.bavail : sf.bfree) || 0);
        } catch (error) {
          logDebug('statfs failed for', mountPoint, error?.message || error);
        }

        const mapped = volumeKind(fsType, mountPoint);
        const baseName = path.posix.basename(mountPoint);
        const name = mountPoint === '/' ? 'Sistema' : baseName || mountPoint;
        return {
          // Encode the mount point rather than stripping punctuation: `/mnt/a-b`
          // and `/mnt/ab` must not share an id, or one mount becomes unreachable.
          id: mountPoint === '/' ? 'real_root' : `real_mount_${encodeURIComponent(mountPoint)}`,
          // A mount point is the POSIX equivalent of `C:\`: it is the explicit
          // root every path on this drive is built from.
          root: mountPoint,
          // Kept as the display label the drive bar expects. It is not used to
          // compose a path.
          letter: mountPoint,
          name,
          type: mapped.type,
          driveKind: mapped.kind,
          fileSystem: fsType,
          totalBytes,
          freeBytes,
          description: `${name} [${mapped.kind}] (${fsType})`,
          isMounted: true,
          device,
        };
      }),
    );
  }

  async function warmUp() {
    // Mounts are already the source of truth; there is no slow metadata query.
  }

  return Object.freeze({ list, warmUp });
}

module.exports = { createLinuxVolumes };
