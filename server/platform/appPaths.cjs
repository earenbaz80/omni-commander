/**
 * The app's data folders, built from the root each adapter chooses.
 *
 * The env overrides are deliberately read on every call: the log and map tests
 * point them at a scratch folder after this module is imported, and the old
 * helpers did the same. Keeping that behavior here means the adapters only
 * decide the OS-specific root.
 */

const path = require('node:path');

const APP_DIR_NAME = 'omnicommander-pro';

function createAppPaths(options = {}) {
  const { baseDir, env = process.env, pathApi = path } = options;
  if (typeof baseDir !== 'function') throw new TypeError('app paths need a baseDir function');

  function appDataDir() {
    const explicit = String(env.OMNI_DATA_DIR || '').trim();
    if (explicit) return explicit;
    return pathApi.join(baseDir(), APP_DIR_NAME);
  }

  /** The throwaway folder: helper scripts only, safe to lose at any moment. */
  function scratchDir() {
    const explicit = String(env.OMNI_SCRATCH_DIR || '').trim();
    return explicit || pathApi.join(appDataDir(), 'tmp');
  }

  /**
   * The offline map cache. Not a scratch file: an area saved before a flight has
   * to survive a restart, so it is pruned by budget rather than emptied on exit.
   */
  function mapTilesDir() {
    const explicit = String(env.OMNI_MAP_CACHE_DIR || '').trim();
    return explicit || pathApi.join(appDataDir(), 'map-tiles');
  }

  /** The diagnostic logs, beside the data they describe. */
  function logsDir() {
    const explicit = String(env.OMNI_LOG_DIR || '').trim();
    return explicit || pathApi.join(appDataDir(), 'logs');
  }

  return Object.freeze({ appDataDir, scratchDir, mapTilesDir, logsDir, pathApi });
}

module.exports = { createAppPaths };
