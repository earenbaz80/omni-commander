#!/usr/bin/env node
// Prints the newest published release on this cut's channel that is not the cut.
//
// The probe compares a feed against one number: the version of the copy asking
// it. Answering "does a machine that has not updated yet see this cut?" needs the
// previous release's number, and writing that number into the workflow would rot
// -- the release it names leaves the page as cuts age, and a step that fails
// because the name went stale says nothing about the app. The list comes from the
// API instead, so the step always simulates the release that precedes this one.
//
// The channel is part of the question, not a detail of it: a stable copy reads
// `latest-linux.yml` and a `-beta.1` copy reads `beta-linux.yml`, so handing a
// stable number to a beta cut would ask the beta feed as a client that never
// reads it, and the answer would describe nobody. The channel is derived from
// the version's prerelease identifier, the way the probe derives it, so the copy
// simulated is one the feed this cut writes could actually serve.
//
// It prints nothing, without failing, when there is no earlier release on that
// channel: the first cut of a channel has no copy installed behind it.
//
// Usage: node scripts/previous-release.cjs [--current <v>]
// Reads GITHUB_REPOSITORY and GITHUB_TOKEN, and prints the version, or nothing.
const DEFAULT_REPO = 'earenbaz80/omni-commander';

/** The version a release publishes, without the tag's `v`. */
function versionOf(release) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
  return tag.replace(/^v/, '');
}

/**
 * The channel a version asks for: the first identifier of its prerelease, or
 * `null` for a stable one. Spelled like `channelOf` in the probe rather than read
 * from the release's flag: `release.yml` marks a release as a prerelease exactly
 * when the version carries a suffix, and what decides the feed file a copy reads
 * is the suffix on its own version.
 */
function channelOf(version) {
  const dash = version.indexOf('-');
  return dash < 0 ? null : version.slice(dash + 1).split('.')[0];
}

/**
 * The newest release on `current`'s channel that is not `current`, ignoring
 * drafts: a draft is not on the page, so no copy could have come from it. An
 * older stable cut is not an answer for a beta one, and the other way round.
 */
function previousVersion(releases, current) {
  const channel = channelOf(current);
  for (const release of releases ?? []) {
    if (release?.draft) continue;
    const version = versionOf(release);
    if (!version || version === current) continue;
    if (channelOf(version) !== channel) continue;
    return version;
  }
  return null;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--current') options.current = argv[(index += 1)];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const current = options.current ?? require('../package.json').version;
  const repo = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, { headers });
  if (!response.ok) throw new Error(`the releases list answered ${response.status} ${response.statusText}`);
  const previous = previousVersion(await response.json(), current);

  // Nothing rather than an error: the caller owns what an empty answer means,
  // and for the first stable cut it means there is nothing to simulate.
  process.stdout.write(previous ? `${previous}\n` : '');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}

module.exports = { channelOf, previousVersion, versionOf };
