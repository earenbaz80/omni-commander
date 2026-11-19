#!/usr/bin/env node
// Writes the Linux update channel from the packages a release serves, checks it
// and attaches it, in one place so the tag and the preflight cannot drift.
//
// The file has to describe what a client downloads, not what a build produced:
// timestamps travel inside a `.deb` and an AppImage, so a rebuild of the same
// tree has different bytes and a channel written from it would name files nobody
// can fetch. That is why both workflows call this after the release exists, with
// no version or tag of their own: it reads `package.json` and asks for
// `v<version>`, so the two invocations are the same line.
//
// The download and the upload come from `release-assets.mjs`, which compares the
// bytes with the size and the digest GitHub records; the channel itself comes
// from `linux-update-channel.cjs`. Electron's updater is not involved here: the
// job that proves the feed with the app's own `DebUpdater` is a separate step,
// so this script needs no dependencies and runs without `npm ci`.
//
// Usage: node scripts/publish-linux-channel.cjs <artifacts-dir>
// Reads GITHUB_REPOSITORY and GITHUB_TOKEN, and writes skipped to GITHUB_OUTPUT:
// `yes` when the tag has no release yet, which is not a finding about the app.
const fs = require('node:fs');
const path = require('node:path');

const { version } = require('../package.json');
const { verifyChannel, writeChannel } = require('./linux-update-channel.cjs');

const ASSETS = [`OmniCommander-Pro-${version}-amd64.deb`, `OmniCommander-Pro-${version}-x86_64.AppImage`];

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summary(lines) {
  const text = `${lines.join('\n')}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

async function main() {
  const artifactsDir = process.argv[2];
  if (!artifactsDir) throw new Error('usage: publish-linux-channel.cjs <artifacts-dir>');

  const tag = `v${version}`;
  const { attachReleaseAsset, fetchReleaseAsset } = await import('./release-assets.mjs');

  for (const assetName of ASSETS) {
    const asset = await fetchReleaseAsset({ tag, assetName, destDir: artifactsDir });
    if (asset.skipped) {
      output('skipped', 'yes');
      summary([
        '### Linux update channel: nothing to write',
        '',
        `- \`${tag}\` publishes no \`.deb\` and no AppImage yet`,
      ]);
      return;
    }
    console.log(`${assetName}: ${asset.bytes} bytes, ${asset.digest}`);
  }

  const channelDir = path.join(artifactsDir, 'channel');
  const { names, text } = writeChannel({
    artifactsDir,
    outDir: channelDir,
    version,
    releaseDate: new Date().toISOString(),
  });
  console.log(text);

  // A size or a sha512 that disagrees with the file is an update every client
  // downloads and then refuses, so the channel is checked against the bytes it
  // describes before it is attached rather than after somebody reports it.
  for (const name of names) {
    const checked = verifyChannel({ channelFile: path.join(channelDir, name), artifactsDir, version });
    for (const entry of checked) {
      console.log(`${entry.url}: ${entry.size} bytes, sha512 matches; ${entry.updater} reads it`);
    }
    console.log(`${name} names both packages of ${version}`);
  }

  const published = await attachReleaseAsset({ tag, files: names.map((name) => path.join(channelDir, name)) });
  if (published.skipped) {
    output('skipped', 'yes');
    summary(['### Linux update channel: nothing to write', '', `- \`${tag}\` has no release to attach the channel to`]);
    return;
  }
  for (const asset of published.published) {
    console.log(`${asset.name}: ${asset.size} bytes, ${asset.state}, ${asset.digest ?? 'no digest recorded'}`);
  }

  summary([
    `### Linux update channel on ${tag}`,
    '',
    '- the updater reads: `latest-linux.yml`',
    `- files: \`${names.join(' ')}\``,
    '- verdict: written from the published packages and attached',
  ]);
  output('skipped', 'no');
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
