/**
 * Linux is a declared target, not a finished adapter.
 *
 * The data roots are real XDG paths and volumes come from the kernel mount
 * table. Cleanup and Open-with stay off until their Linux implementation and
 * vertical slice exist; leaving them out of the adapter is what makes the
 * capabilities false and keeps a Windows fallback from being reached.
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

  return definePlatform({
    id: 'linux',
    contractVersion: CONTRACT_VERSION,
    capabilities: capabilitiesOf({ paths: true, trash: true, volumes: true, userFolders: true }),
    paths,
    volumes,
    trash,
    userFolders,
  });
}

module.exports = { createLinuxPlatform };
