#!/usr/bin/env node
// Writes and checks the channel file a Linux copy of the app reads.
//
// On Linux x64 electron-updater asks GitHub for `latest-linux.yml` -- the name
// carries a platform suffix the Windows release already publishes without -- and
// it resolves one download per extension: a `.deb` entry for DebUpdater, an
// `.AppImage` entry for AppImageUpdater. A release that carries the two packages
// and no channel file has no Linux feed at all; the check answers
// ERR_UPDATER_CHANNEL_FILE_NOT_FOUND, which in the window reads like "no updates"
// rather than "no file".
//
// The file is written from the published artifacts themselves, so the size and
// the sha512 it declares are the ones a client verifies before installing. A
// fresh build would not do: timestamps travel inside a .deb and an AppImage, so a
// rebuild of the same tree produces different bytes and a channel written from it
// would describe files nobody can download.
//
// Usage:
//   node scripts/linux-update-channel.cjs write <artifacts-dir> [--out <dir>] [--version <v>]
//   node scripts/linux-update-channel.cjs verify <channel-file> <artifacts-dir> [--version <v>]
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CHANNEL_NAME = 'latest-linux.yml';

/** The extension each updater looks for, and the class that asks for it. */
const REQUIRED = [
  { extension: '.deb', updater: 'DebUpdater' },
  { extension: '.AppImage', updater: 'AppImageUpdater' },
];

function packageVersion() {
  return require('../package.json').version;
}

function sha512Of(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

/** The one package of each kind the channel can describe. */
function artifactsIn(dir) {
  const names = fs.readdirSync(dir).filter((name) => REQUIRED.some(({ extension }) => name.endsWith(extension)));
  const chosen = [];
  for (const { extension } of REQUIRED) {
    const matches = names.filter((name) => name.endsWith(extension));
    if (matches.length !== 1) {
      throw new Error(
        `${dir} holds ${matches.length} ${extension} files; the channel describes exactly one (${names.join(', ') || 'none'})`,
      );
    }
    chosen.push(matches[0]);
  }
  return chosen;
}

function describeArtifact(dir, name) {
  const file = path.join(dir, name);
  return { url: name, size: fs.statSync(file).size, sha512: sha512Of(file) };
}

/**
 * A pre-release also carries the file its own copies ask for first
 * (`beta-linux.yml` for `1.0.53-beta.1`), the way the Windows job copies its
 * channel beside `latest.yml`.
 */
function channelNameFor(version) {
  const dash = version.indexOf('-');
  if (dash < 0) return [];
  return [`${version.slice(dash + 1).split('.')[0]}-linux.yml`];
}

function writeChannel({ artifactsDir, outDir, version, releaseDate }) {
  const entries = artifactsIn(artifactsDir).map((name) => describeArtifact(artifactsDir, name));
  const text = [
    `version: ${version}`,
    'files:',
    ...entries.flatMap((entry) => [`  - url: ${entry.url}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`]),
    // What electron-updater read before `files` existed. Kept beside the list
    // because it costs nothing and the older clients a stray copy might still
    // run look for it.
    `path: ${entries[0].url}`,
    `sha512: ${entries[0].sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  fs.mkdirSync(outDir, { recursive: true });
  const names = [CHANNEL_NAME, ...channelNameFor(version)];
  for (const name of names) fs.writeFileSync(path.join(outDir, name), text);
  return { names, entries, text };
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Reads the parts of the channel this script writes and the updater reads. Only
 * line by line, so a file electron-builder wrote by another route is read the
 * same way as long as it carries `version` and a `files` list.
 */
function readChannel(text) {
  const channel = { version: null, files: [] };
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const version = /^version:\s*(.+?)\s*$/.exec(line);
    if (version) {
      channel.version = unquote(version[1]);
      continue;
    }
    const url = /^\s*-\s*url:\s*(.+?)\s*$/.exec(line);
    if (url) {
      current = { url: unquote(url[1]), size: null, sha512: null };
      channel.files.push(current);
      continue;
    }
    if (current == null) continue;
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line);
    if (size) {
      current.size = Number(size[1]);
      continue;
    }
    const sha512 = /^\s+sha512:\s*(.+?)\s*$/.exec(line);
    if (sha512) current.sha512 = unquote(sha512[1]);
  }
  return channel;
}

/**
 * What the release promises: this version, both packages, and a size and sha512
 * per package that match the file of that name. The updater verifies the sha512
 * of what it downloads, so a channel that disagrees with the file is an update
 * every client refuses -- after downloading it.
 */
function verifyChannel({ channelFile, artifactsDir, version }) {
  const name = path.basename(channelFile);
  const channel = readChannel(fs.readFileSync(channelFile, 'utf8'));
  if (channel.version !== version) {
    throw new Error(`${name} declares version ${channel.version ?? '(none)'}, package.json says ${version}`);
  }
  if (channel.files.length === 0) throw new Error(`${name} lists no files`);

  for (const entry of channel.files) {
    if (!fs.existsSync(path.join(artifactsDir, entry.url))) {
      throw new Error(`${name} names ${entry.url}, which is not in ${artifactsDir}`);
    }
  }

  const checked = [];
  for (const { extension, updater } of REQUIRED) {
    const entry = channel.files.find((file) => file.url.toLowerCase().endsWith(extension.toLowerCase()));
    if (!entry) {
      throw new Error(
        `${name} carries no ${extension} entry, so ${updater} would have ${channel.files.map((file) => file.url).join(', ')}`,
      );
    }
    const actual = describeArtifact(artifactsDir, entry.url);
    if (entry.size !== actual.size) {
      throw new Error(`${name} declares ${entry.size} bytes for ${entry.url}, the file has ${actual.size}`);
    }
    if (entry.sha512 !== actual.sha512) {
      throw new Error(`${name} declares a sha512 for ${entry.url} that the file does not have`);
    }
    checked.push({ ...entry, updater });
  }
  return checked;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { version: null, out: null, paths: [] };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--version') options.version = rest[(index += 1)];
    else if (rest[index] === '--out') options.out = rest[(index += 1)];
    else options.paths.push(rest[index]);
  }
  return { command, ...options };
}

function main() {
  const { command, paths, version: askedVersion, out } = parseArgs(process.argv.slice(2));
  const version = askedVersion ?? packageVersion();

  if (command === 'write') {
    const artifactsDir = paths[0];
    if (!artifactsDir) {
      throw new Error('usage: linux-update-channel.cjs write <artifacts-dir> [--out <dir>] [--version <v>]');
    }
    const outDir = out ?? artifactsDir;
    const { names, entries } = writeChannel({ artifactsDir, outDir, version, releaseDate: new Date().toISOString() });
    for (const entry of entries)
      console.log(`${entry.url}: ${entry.size} bytes, sha512:${entry.sha512.slice(0, 16)}...`);
    for (const name of names) console.log(`wrote ${path.join(outDir, name)} for ${version}`);
    return;
  }

  if (command === 'verify') {
    const [channelFile, artifactsDir] = paths;
    if (!channelFile || !artifactsDir) {
      throw new Error('usage: linux-update-channel.cjs verify <channel-file> <artifacts-dir> [--version <v>]');
    }
    const checked = verifyChannel({ channelFile, artifactsDir, version });
    for (const entry of checked)
      console.log(`${entry.url}: ${entry.size} bytes, sha512 matches; ${entry.updater} reads it`);
    console.log(`${path.basename(channelFile)} names both packages of ${version}`);
    return;
  }

  throw new Error('usage: linux-update-channel.cjs write <artifacts-dir> | verify <channel-file> <artifacts-dir>');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  CHANNEL_NAME,
  artifactsIn,
  channelNameFor,
  describeArtifact,
  readChannel,
  sha512Of,
  verifyChannel,
  writeChannel,
};
