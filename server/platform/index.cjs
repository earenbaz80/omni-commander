/**
 * Chooses the adapter for the running system.
 *
 * The selection lives in one place so the rest of the server never reads
 * `process.platform` to answer a product question. A platform with no adapter
 * fails here, before a feature can misbehave halfway through.
 */

const { createLinuxPlatform } = require('./linux.cjs');
const { createWindowsPlatform } = require('./windows.cjs');

function createPlatform(platform = process.platform, options = {}) {
  if (platform === 'win32') return createWindowsPlatform(options);
  if (platform === 'linux') return createLinuxPlatform(options);
  throw new Error(`Unsupported platform: ${String(platform)}`);
}

module.exports = { createPlatform };
