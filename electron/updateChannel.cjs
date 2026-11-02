/**
 * The update channel, as the interface offers it.
 *
 * `stable` is the default and every unknown value falls back to it: an opt-in
 * that can be flipped by a broken file would ship test builds to people who
 * never asked for them. `beta` is what turns prereleases into candidates.
 *
 * Nothing here decides where releases live. The repository is public, so the
 * `app-update.yml` electron-builder writes into the package is all the updater
 * needs, and it reads that file itself.
 *
 * It lives here, apart from main.cjs, so the decision can be tested without
 * launching Electron.
 */

/**
 * The update channel, as the interface offers it.
 *
 * `stable` is the default and every unknown value falls back to it: an opt-in
 * that can be flipped by a broken file would ship test builds to people who
 * never asked for them. `beta` is what turns prereleases into candidates.
 */
function normalizeChannel(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'beta' ? 'beta' : 'stable';
}

/**
 * Reads the channel from the file the settings write. Missing, unreadable or
 * anything unrecognised is `stable`: a machine that cannot read the note is not
 * a machine that opted into test builds.
 */
function readUpdateChannel({ channelPath, readFile } = {}) {
  if (!channelPath || typeof readFile !== 'function') return 'stable';
  let text;
  try {
    text = readFile(channelPath);
  } catch {
    return 'stable';
  }
  return normalizeChannel(text);
}

module.exports = {
  normalizeChannel,
  readUpdateChannel,
};
