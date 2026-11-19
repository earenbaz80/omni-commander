#!/usr/bin/env node
// Attaches files to the release of a tag, replacing any asset of the same name.
//
// The Windows job publishes its files as it creates the release, but the Linux
// channel cannot be written before it: it is generated from the published
// packages, because that is the only way its size and sha512 describe what users
// download rather than what a rebuild produced. So it is attached afterwards, to
// a release that already exists.
//
// The upload endpoint only creates, so an asset with the name being published is
// deleted first; without that, a second run against the same version answers 422.
//
// Usage: node scripts/publish-release-asset.mjs <tag> <file> [<file>...]
// Requires GITHUB_TOKEN, reads GITHUB_REPOSITORY, and writes skipped to
// GITHUB_OUTPUT when the tag has no release yet.
import fs from 'node:fs';
import path from 'node:path';

const repo = process.env.GITHUB_REPOSITORY ?? 'earenbaz80/omni-commander';
const token = process.env.GITHUB_TOKEN;
const [tag, ...files] = process.argv.slice(2);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function headers(extra = {}) {
  return { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, ...extra };
}

if (!tag || files.length === 0) fail('usage: publish-release-asset.mjs <tag> <file> [<file>...]');
if (!token) fail('GITHUB_TOKEN is required to publish an asset');

const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
  headers: headers(),
});
if (releaseResponse.status === 404) {
  output('skipped', 'yes');
  console.log(`::notice::${tag} has no release yet, so there is nothing to attach to`);
  process.exit(0);
}
if (!releaseResponse.ok) fail(`the release API answered HTTP ${releaseResponse.status} for ${tag}`);

const release = await releaseResponse.json();

for (const file of files) {
  const name = path.basename(file);
  const body = fs.readFileSync(file);

  const existing = release.assets.find((asset) => asset.name === name);
  if (existing) {
    const removed = await fetch(existing.url, { method: 'DELETE', headers: headers() });
    if (!removed.ok) fail(`could not replace ${name}: deleting the previous asset answered HTTP ${removed.status}`);
    console.log(`replaced ${name} (the previous asset is gone)`);
  }

  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const uploaded = await fetch(uploadUrl, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/octet-stream' }),
    body,
  });
  if (!uploaded.ok)
    fail(`uploading ${name} answered HTTP ${uploaded.status}: ${(await uploaded.text()).slice(0, 300)}`);

  const asset = await uploaded.json();
  if (asset.size !== body.length) fail(`${name} was published with ${asset.size} bytes, the file has ${body.length}`);
  console.log(`${asset.name}: ${asset.size} bytes, ${asset.state}, ${asset.digest ?? 'no digest recorded'}`);
}

output('skipped', 'no');
console.log(`published ${files.length} asset(s) on ${tag}`);
