#!/usr/bin/env node
// Downloads an asset from the release of a tag and checks it against the size
// and the digest GitHub records for that asset, so a job that installs or boots
// "the published file" cannot quietly test a different one.
//
// A tag with no release is reported as skipped rather than as a failure: there
// is nothing to check until the version is cut, which is not the same finding as
// a package that will not start.
//
// The download and the check live in `release-assets.mjs`, shared with the step
// that writes the Linux channel; this file only gives them a command line and a
// runner's outputs.
//
// Usage: node scripts/fetch-release-asset.mjs <tag> <asset-name> <dest-dir>
// Reads GITHUB_REPOSITORY and GITHUB_TOKEN, and writes skipped, asset, digest and
// bytes to GITHUB_OUTPUT when the runner provides one.
import fs from 'node:fs';

import { fetchReleaseAsset } from './release-assets.mjs';

const [tag, assetName, destDir] = process.argv.slice(2);
if (!tag || !assetName || !destDir) {
  console.error('usage: fetch-release-asset.mjs <tag> <asset-name> <dest-dir>');
  process.exit(2);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

let result;
try {
  result = await fetchReleaseAsset({ tag, assetName, destDir });
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}

if (result.skipped) {
  output('skipped', 'yes');
  console.log(`::notice::${tag} has no release yet, so there is no published ${assetName} to check`);
  process.exit(0);
}

console.log(`${assetName}: ${result.bytes} bytes, ${result.digest}`);
output('skipped', 'no');
output('asset', assetName);
output('digest', result.digest.slice('sha256:'.length));
output('bytes', String(result.bytes));
