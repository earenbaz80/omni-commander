#!/usr/bin/env node
// Prints the newest published release that is not the cut this tree carries.
//
// The probe compares a feed against one number: the version of the copy asking
// it. Answering "does a machine that has not updated yet see this cut?" needs the
// previous release's number, and writing that number into the workflow would rot
// -- the release it names leaves the page as cuts age, and a step that fails
// because the name went stale says nothing about the app. The list comes from the
// API instead, so the step always simulates the release that precedes this one,
// and prints nothing, without failing, when there is none: the first stable cut
// has no copy installed behind it.
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
 * The newest release that is not `current`, ignoring drafts and pre-releases: a
 * draft is not on the page, so no copy could have come from it, and a beta's copy
 * asks for another channel than the one this check reads.
 */
function previousVersion(releases, current) {
  for (const release of releases ?? []) {
    if (release?.draft || release?.prerelease) continue;
    const version = versionOf(release);
    if (!version || version === current) continue;
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

module.exports = { previousVersion, versionOf };
