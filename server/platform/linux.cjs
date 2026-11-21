/**
 * Linux is a declared target, not a finished adapter.
 *
 * The data roots are real XDG paths and volumes come from the kernel mount
 * table. Cleanup covers the user temp folder only: the Windows temp and
 * Prefetch targets have no POSIX equivalent. Open-with stays off until its
 * Linux implementation exists; leaving it out of the adapter is what makes the
 * capability false and keeps a Windows fallback from being reached.
 */

const os = require('node:os');
const path = require('node:path');

const { createAppPaths } = require('./appPaths.cjs');
const { CONTRACT_VERSION, capabilitiesOf, definePlatform } = require('./contract.cjs');
const { createLinuxTrash } = require('./linuxTrash.cjs');
const { createLinuxUserFolders } = require('./linuxUserFolders.cjs');
const { createLinuxVolumes } = require('./linuxVolumes.cjs');

function createLinuxPlatform(options = {}) {
  const env = options.env || process.env;

  const paths = createAppPaths({
    env,
    pathApi: path.posix,
    baseDir: () => String(env.XDG_CONFIG_HOME || '').trim() || path.posix.join(os.homedir(), '.config'),
  });

  const volumes = createLinuxVolumes({
    fs: options.fs,
    mountsFile: options.mountsFile,
    readMounts: options.readMounts,
    statfs: options.statfs,
    logDebug: options.logDebug,
  });

  const trash = createLinuxTrash({
    env,
    fs: options.fs,
    execFileAsync: options.execFileAsync,
    now: options.now,
    logDebug: options.logDebug,
  });

  // The libraries the panel shows first are the desktop's XDG folders, which
  // the locale names: the Windows table cannot answer this question here.
  const userFolders = createLinuxUserFolders({
    env,
    fs: options.fs,
    home: options.home,
  });

  // The Windows adapter also clears the system temp folder and Prefetch, which
  // are administrator-owned; POSIX only has a user temp target with an
  // equivalent. The walk and delete routines are the same on both sides.
  const tempOverride = String(env.OMNI_CLEANUP_USER_TEMP_ROOT || '').trim();
  const cleanupTargets = Object.freeze({
    'user-temp': Object.freeze({
      resolve: () => tempOverride || env.TMPDIR || '/tmp',
      requiresAdmin: false,
    }),
  });

  function cleanupTargetPath(targetId) {
    const target = cleanupTargets[targetId];
    if (!target) return '';
    const raw = target.resolve();
    if (!raw || !path.posix.isAbsolute(raw)) return '';
    return path.posix.normalize(raw);
  }

  function resolveCleanupRoot(targetId) {
    if (!cleanupTargets[targetId]) throw new Error(`Unknown cleanup target: ${String(targetId || '')}`);
    if (cleanupTargets[targetId].requiresAdmin) {
      throw new Error(`${targetId} needs administrator rights`);
    }
    const root = cleanupTargetPath(targetId);
    if (!root) throw new Error(`No folder for cleanup target: ${String(targetId || '')}`);
    if (root === '/') throw new Error(`Refusing to clean a filesystem root: ${root}`);
    return root;
  }

  const cleanup = Object.freeze({
    targets: cleanupTargets,
    targetPath: cleanupTargetPath,
    resolveRoot: resolveCleanupRoot,
  });

  return definePlatform({
    id: 'linux',
    contractVersion: CONTRACT_VERSION,
    capabilities: capabilitiesOf({ paths: true, cleanup: true, trash: true, volumes: true, userFolders: true }),
    paths,
    cleanup,
    volumes,
    trash,
    userFolders,
  });
}

module.exports = { createLinuxPlatform };
