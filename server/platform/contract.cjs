/**
 * The platform seam.
 *
 * Features ask for a capability, never for `process.platform`. Each adapter
 * declares every connected domain as a boolean, so a missing Linux feature is
 * a named gap instead of an accidental Windows call. A new domain is added here
 * together with its adapter, never guessed in advance.
 */

const CONTRACT_VERSION = 1;

const CAPABILITIES = Object.freeze(['paths', 'volumes', 'cleanup', 'trash', 'openWith']);

const PLATFORM_IDS = Object.freeze(['win32', 'linux']);

/** An explicit boolean for every capability, so `undefined` cannot mean "no". */
function capabilitiesOf(enabled = {}) {
  const result = {};
  for (const name of CAPABILITIES) result[name] = enabled[name] === true;
  return result;
}

function assertPlatform(platform) {
  if (!platform || typeof platform !== 'object') {
    throw new TypeError('Platform adapter must be an object');
  }
  if (platform.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`Platform adapter contract version must be ${CONTRACT_VERSION}`);
  }
  if (!PLATFORM_IDS.includes(platform.id)) {
    throw new Error(`Unknown platform adapter: ${String(platform.id)}`);
  }
  if (!platform.capabilities || typeof platform.capabilities !== 'object') {
    throw new Error(`Platform ${platform.id} must declare its capabilities`);
  }
  for (const name of CAPABILITIES) {
    if (typeof platform.capabilities[name] !== 'boolean') {
      throw new Error(`Platform ${platform.id} must declare capability ${name} as a boolean`);
    }
  }
  if (platform.capabilities.paths) {
    const paths = platform.paths;
    const methods = ['appDataDir', 'scratchDir', 'mapTilesDir', 'logsDir'];
    const pathMethods = ['join', 'normalize', 'isAbsolute'];
    if (
      !paths ||
      typeof paths !== 'object' ||
      methods.some((method) => typeof paths[method] !== 'function') ||
      !paths.pathApi ||
      typeof paths.pathApi !== 'object' ||
      typeof paths.pathApi.sep !== 'string' ||
      pathMethods.some((method) => typeof paths.pathApi[method] !== 'function')
    ) {
      throw new Error(`Platform ${platform.id} declares paths but does not implement it`);
    }
  }
  if (platform.capabilities.cleanup) {
    const cleanup = platform.cleanup;
    if (
      !cleanup ||
      typeof cleanup !== 'object' ||
      !cleanup.targets ||
      typeof cleanup.targetPath !== 'function' ||
      typeof cleanup.resolveRoot !== 'function'
    ) {
      throw new Error(`Platform ${platform.id} declares cleanup but does not implement it`);
    }
  }
  if (platform.capabilities.volumes) {
    const volumes = platform.volumes;
    const methods = ['list', 'warmUp'];
    if (!volumes || typeof volumes !== 'object' || methods.some((method) => typeof volumes[method] !== 'function')) {
      throw new Error(`Platform ${platform.id} declares volumes but does not implement it`);
    }
  }
  if (platform.capabilities.trash) {
    const trash = platform.trash;
    if (!trash || typeof trash !== 'object' || typeof trash.move !== 'function') {
      throw new Error(`Platform ${platform.id} declares trash but does not implement it`);
    }
  }
  if (platform.capabilities.openWith) {
    const openWith = platform.openWith;
    const methods = ['programsFor', 'isProgram', 'launch', 'picker'];
    if (!openWith || typeof openWith !== 'object' || methods.some((method) => typeof openWith[method] !== 'function')) {
      throw new Error(`Platform ${platform.id} declares openWith but does not implement it`);
    }
  }
  return platform;
}

/** Freezes the declaration so a caller cannot silently add a capability later. */
function definePlatform(platform) {
  assertPlatform(platform);
  return Object.freeze({
    ...platform,
    capabilities: Object.freeze({ ...platform.capabilities }),
  });
}

/**
 * Returns the capability object, or fails before a feature can fall through to
 * a Windows default. `server/platform/index.cjs` only returns adapters that
 * passed `definePlatform`, so this is the runtime half of the contract.
 */
function requireCapability(platform, name) {
  if (!CAPABILITIES.includes(name)) {
    throw new Error(`Unknown platform capability: ${String(name)}`);
  }
  if (!platform || !platform.capabilities || platform.capabilities[name] !== true || !platform[name]) {
    throw new Error(`Platform ${platform && platform.id ? platform.id : 'unknown'} does not implement ${name}`);
  }
  return platform[name];
}

module.exports = {
  CONTRACT_VERSION,
  CAPABILITIES,
  capabilitiesOf,
  assertPlatform,
  definePlatform,
  requireCapability,
};
