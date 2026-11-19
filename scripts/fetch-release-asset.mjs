#!/usr/bin/env node
// Downloads an asset from the release of a tag and checks it against the size
// and the digest GitHub records for that asset, so a job that installs or boots
// "the published file" cannot quietly test a different one.
//
// A tag with no release is reported as skipped rather than as a failure: there
// is nothing to check until the version is cut, which is not the same finding as
// a package that will not start.
//
// Usage: node scripts/fetch-release-asset.mjs <tag> <asset-name> <dest-dir>
// Reads GITHUB_REPOSITORY and GITHUB_TOKEN, and writes skipped, asset, digest and
// bytes to GITHUB_OUTPUT when the runner provides one.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [tag, assetName, destDir] = process.argv.slice(2);
if (!tag || !assetName || !destDir) {
  console.error('usage: fetch-release-asset.mjs <tag> <asset-name> <dest-dir>');
  process.exit(2);
}

const repo = process.env.GITHUB_REPOSITORY ?? 'earenbaz80/omni-commander';
const headers = { accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) {
  headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
if (releaseResponse.status === 404) {
  output('skipped', 'yes');
  console.log(`::notice::${tag} has no release yet, so there is no published ${assetName} to check`);
  process.exit(0);
}
if (!releaseResponse.ok) {
  console.error(`::error::the release API answered HTTP ${releaseResponse.status} for ${tag}`);
  process.exit(1);
}

const release = await releaseResponse.json();
const asset = release.assets.find((candidate) => candidate.name === assetName);
if (!asset) {
  console.error(`::error::${tag} publishes no ${assetName}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, assetName);
const download = await fetch(asset.browser_download_url);
if (!download.ok || !download.body) {
  console.error(`::error::the download of ${assetName} answered HTTP ${download.status}`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(dest));

const bytes = fs.statSync(dest).size;
const hash = createHash('sha256');
for await (const chunk of fs.createReadStream(dest)) {
  hash.update(chunk);
}
const digest = `sha256:${hash.digest('hex')}`;
console.log(`${assetName}: ${bytes} bytes, ${digest}`);

// The recorded digest is what the download URL is expected to serve; a mismatch
// means the file this job would install is not the file the release names.
if (bytes !== asset.size) {
  console.error(`::error::the downloaded ${assetName} is ${bytes} bytes, the release says ${asset.size}`);
  process.exit(1);
}
if (asset.digest && asset.digest !== digest) {
  console.error(`::error::${assetName} does not match the digest the release records (${asset.digest})`);
  process.exit(1);
}

output('skipped', 'no');
output('asset', assetName);
output('digest', digest.slice('sha256:'.length));
output('bytes', String(bytes));
