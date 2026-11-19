#!/usr/bin/env node
// Attaches files to the release of a tag, replacing any asset of the same name.
//
// The Windows job publishes its files as it creates the release, but the Linux
// channel cannot be written before it: it is generated from the published
// packages, because that is the only way its size and sha512 describe what users
// download rather than what a rebuild produced. So it is attached afterwards, to
// a release that already exists.
//
// The upload and the replacement live in `release-assets.mjs`, shared with the
// step that writes the Linux channel; this file only gives them a command line
// and a runner's outputs.
//
// Usage: node scripts/publish-release-asset.mjs <tag> <file> [<file>...]
// Requires GITHUB_TOKEN, reads GITHUB_REPOSITORY, and writes skipped to
// GITHUB_OUTPUT when the tag has no release yet.
import fs from 'node:fs';

import { attachReleaseAsset } from './release-assets.mjs';

const [tag, ...files] = process.argv.slice(2);

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (!tag || files.length === 0) {
  console.error('usage: publish-release-asset.mjs <tag> <file> [<file>...]');
  process.exit(2);
}
if (!process.env.GITHUB_TOKEN) {
  console.error('::error::GITHUB_TOKEN is required to publish an asset');
  process.exit(1);
}

let result;
try {
  result = await attachReleaseAsset({ tag, files });
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}

if (result.skipped) {
  output('skipped', 'yes');
  console.log(`::notice::${tag} has no release yet, so there is nothing to attach to`);
  process.exit(0);
}

for (const asset of result.published) {
  if (asset.replaced) console.log(`replaced ${asset.name} (the previous asset is gone)`);
  console.log(`${asset.name}: ${asset.size} bytes, ${asset.state}, ${asset.digest ?? 'no digest recorded'}`);
}

output('skipped', 'no');
console.log(`published ${files.length} asset(s) on ${tag}`);
