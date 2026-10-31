/**
 * Where the updater looks for a release, and with which credentials.
 *
 * The app is published from a private GitHub repository, so the anonymous
 * `releases/download/...` URLs electron-updater uses by default answer 404 to
 * every installed copy: no update is ever offered. A token switches the library
 * to its private provider, which reads the latest release and its assets through
 * the authenticated API instead.
 *
 * The target is read from the `app-update.yml` electron-builder writes next to
 * the app, because that file is the one the updater itself loads and it is
 * present in every packaged build. The token is the user's own: read from the
 * machine, never bundled, and needing nothing beyond read access.
 *
 * It all lives here, apart from main.cjs, so the decision can be tested without
 * launching Electron.
 */

/**
 * Shortest value accepted as a token. GitHub's own tokens are far longer; the
 * bound is here to reject a placeholder like `change-me` or a half-pasted line
 * before it is sent as an Authorization header.
 */
const MIN_TOKEN_LENGTH = 20;

/**
 * A usable token, or null.
 *
 * Files edited by hand arrive with a newline, a trailing space or the quotes
 * some editors add, and any of those in an Authorization header makes GitHub
 * answer 401. Only the first non-empty line is considered: a note written under
 * the token must not be glued onto it.
 */
function normalizeToken(raw) {
  if (typeof raw !== 'string') return null;
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const unquoted = firstLine.replace(/^(['"`])(.+)\1$/, '$2').trim();
  if (unquoted.length < MIN_TOKEN_LENGTH) return null;
  // Whitespace inside a token is always a mistake, and a token containing it is
  // rejected rather than silently repaired into something that cannot work.
  if (/\s/.test(unquoted)) return null;
  return unquoted;
}

/**
 * The GitHub target out of the flat `key: value` file electron-builder writes
 * (`provider: github`, `owner: ...`, `repo: ...`, plus cosmetic keys).
 *
 * Parsed here instead of with a YAML library: this file is written by one tool,
 * has one shape, and a parser for three keys cannot disagree with the document
 * the updater itself reads. Anything unexpected yields null rather than a guess.
 */
function parseFeedConfig(text) {
  if (typeof text !== 'string') return null;

  const fields = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Comments and the blank lines around them carry no configuration.
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }

  if (fields.provider !== 'github' || !fields.owner || !fields.repo) return null;
  return { provider: 'github', owner: fields.owner, repo: fields.repo };
}

/** Reads and parses `app-update.yml`; a missing or broken file is "no target". */
function readFeedConfig(filePath, readFile) {
  if (!filePath || typeof readFile !== 'function') return null;
  let text;
  try {
    text = readFile(filePath);
  } catch {
    return null;
  }
  return parseFeedConfig(text);
}

/**
 * Reads the token from the machine: the environment first (handy on a shared
 * machine), then the file the interface points at. An unreadable file is simply
 * "no token": a missing credential must not break the launch.
 */
function readUpdateToken({ env, tokenPath, readFile } = {}) {
  const fromEnv = normalizeToken(env && env.OMNI_UPDATE_TOKEN);
  if (fromEnv) return { token: fromEnv, source: 'env' };

  if (tokenPath && typeof readFile === 'function') {
    let raw = null;
    try {
      raw = readFile(tokenPath);
    } catch {
      raw = null;
    }
    const fromFile = normalizeToken(raw);
    if (fromFile) return { token: fromFile, source: 'file' };
  }

  return { token: null, source: null };
}

/**
 * A calendar date as `YYYY-MM-DD`, or null.
 *
 * Fine-grained tokens expire, and GitHub only shows that date when the token is
 * created or edited, so the machine records it next to the credential: the
 * settings can then warn before the check starts answering 401. The shape is the
 * one `<input type="date">` produces, and an impossible day (2027-02-30) is
 * rejected rather than silently rolled into March by the Date constructor.
 */
function normalizeExpiry(raw) {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

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

/**
 * Reads the recorded expiry from the small file kept beside the token. Missing,
 * unreadable or malformed is simply "no date known": a note that cannot be read
 * must not keep the app from starting or make the settings claim a date.
 */
function readTokenExpiry({ metaPath, readFile } = {}) {
  if (!metaPath || typeof readFile !== 'function') return null;
  let text;
  try {
    text = readFile(metaPath);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return normalizeExpiry(parsed && parsed.tokenExpiresAt);
  } catch {
    return null;
  }
}

/**
 * The feed options handed to `autoUpdater.setFeedURL`, plus what the interface
 * needs to explain a failed check. `options` is null when the package declares
 * no GitHub target, in which case the updater keeps whatever `app-update.yml`
 * says.
 */
function resolveUpdateFeed({ appUpdateConfigPath, env, tokenPath, readFile } = {}) {
  const base = readFeedConfig(appUpdateConfigPath, readFile);
  const { token, source } = readUpdateToken({ env, tokenPath, readFile });

  return {
    base,
    token,
    tokenSource: source,
    tokenPath: tokenPath ?? null,
    // Without a token the public provider is used, which is right for a public
    // repository and fails with a clear "cannot find latest.yml" for a private
    // one; the About box turns that into an instruction.
    options: base ? (token ? { ...base, token } : base) : null,
  };
}

module.exports = {
  MIN_TOKEN_LENGTH,
  normalizeToken,
  normalizeChannel,
  readUpdateChannel,
  normalizeExpiry,
  parseFeedConfig,
  readFeedConfig,
  readUpdateToken,
  readTokenExpiry,
  resolveUpdateFeed,
};
