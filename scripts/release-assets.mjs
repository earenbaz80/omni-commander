// Reads and writes release assets, with the checks that make "the published
// file" mean something.
//
// Two command-line scripts and one workflow step need the same two operations:
// download an asset and compare it with the size and the digest GitHub records,
// and attach a file to the release of a tag, replacing the asset of that name.
// Keeping them here means the checks cannot drift between the job that installs
// a package, the job that boots it and the job that writes the channel
// describing it.
//
// Nothing here prints `::error::` or exits: the wrappers own that, so a library
// caller gets an exception with a message instead of a dead process.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_REPO = 'earenbaz80/omni-commander';

function headers(token, extra = {}) {
  const result = { accept: 'application/vnd.github+json', ...extra };
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

function releaseUrl(tag, repo) {
  return `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
}

/**
 * Downloads `<assetName>` from the release of `<tag>` into `<destDir>`.
 *
 * The bytes are hashed as they land and compared with what the release records,
 * because a file that the download URL does not serve is not the file the job
 * claims to be checking. A tag with no release answers `{ skipped: true }`:
 * there is nothing to check until the version is cut, which is not the same
 * finding as a package that will not start.
 */
export async function fetchReleaseAsset({
  tag,
  assetName,
  destDir,
  repo = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO,
  token = process.env.GITHUB_TOKEN,
}) {
  const releaseResponse = await fetch(releaseUrl(tag, repo), { headers: headers(token) });
  if (releaseResponse.status === 404) return { skipped: true, assetName, tag };
  if (!releaseResponse.ok) {
    throw new Error(`the release API answered HTTP ${releaseResponse.status} for ${tag}`);
  }

  const release = await releaseResponse.json();
  const asset = release.assets.find((candidate) => candidate.name === assetName);
  if (!asset) throw new Error(`${tag} publishes no ${assetName}`);

  fs.mkdirSync(destDir, { recursive: true });
  const file = path.join(destDir, assetName);
  const download = await fetch(asset.browser_download_url);
  if (!download.ok || !download.body) {
    throw new Error(`the download of ${assetName} answered HTTP ${download.status}`);
  }
  await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(file));

  const bytes = fs.statSync(file).size;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const digest = `sha256:${hash.digest('hex')}`;

  if (bytes !== asset.size) {
    throw new Error(`the downloaded ${assetName} is ${bytes} bytes, the release says ${asset.size}`);
  }
  if (asset.digest && asset.digest !== digest) {
    throw new Error(`${assetName} does not match the digest the release records (${asset.digest})`);
  }

  return { skipped: false, path: file, bytes, digest, assetName, tag };
}

/**
 * Attaches `<files>` to the release of `<tag>`, replacing any asset of the same
 * name: the upload endpoint only creates, so a second run against the same
 * version would otherwise answer 422.
 *
 * A tag with no release answers `{ skipped: true }` for the same reason the
 * download does.
 */
export async function attachReleaseAsset({
  tag,
  files,
  repo = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO,
  token = process.env.GITHUB_TOKEN,
}) {
  if (!token) throw new Error('GITHUB_TOKEN is required to publish an asset');

  const releaseResponse = await fetch(releaseUrl(tag, repo), { headers: headers(token) });
  if (releaseResponse.status === 404) return { skipped: true, tag };
  if (!releaseResponse.ok) {
    throw new Error(`the release API answered HTTP ${releaseResponse.status} for ${tag}`);
  }

  const release = await releaseResponse.json();
  const published = [];
  let replaced = false;
  for (const file of files) {
    const name = path.basename(file);
    const body = fs.readFileSync(file);

    const existing = release.assets.find((asset) => asset.name === name);
    if (existing) {
      replaced = true;
      const removed = await fetch(existing.url, { method: 'DELETE', headers: headers(token) });
      if (!removed.ok) {
        throw new Error(`could not replace ${name}: deleting the previous asset answered HTTP ${removed.status}`);
      }
    }

    const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
    const uploaded = await fetch(uploadUrl, {
      method: 'POST',
      headers: headers(token, { 'content-type': 'application/octet-stream' }),
      body,
    });
    if (!uploaded.ok) {
      const detail = (await uploaded.text()).slice(0, 300);
      throw new Error(`uploading ${name} answered HTTP ${uploaded.status}: ${detail}`);
    }

    const asset = await uploaded.json();
    if (asset.size !== body.length) {
      throw new Error(`${name} was published with ${asset.size} bytes, the file has ${body.length}`);
    }
    published.push({
      name: asset.name,
      size: asset.size,
      state: asset.state,
      digest: asset.digest ?? null,
      replaced,
    });
    replaced = false;
  }

  return { skipped: false, published, tag };
}
