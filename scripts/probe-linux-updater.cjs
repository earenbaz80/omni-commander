#!/usr/bin/env node
// Asks the feed the way an installed Linux copy does.
//
// The .deb ships `resources/package-type` (`deb`) and `resources/app-update.yml`,
// so electron-updater picks DebUpdater, which asks GitHub for `latest-linux.yml`
// and resolves the `.deb` entry in it. Nothing here reads the channel file
// directly: if it is missing, malformed, or names a package the release does not
// have, this fails with the same error the window shows, which is the whole point
// of the check -- a release can carry both packages and still offer no update.
//
// It runs outside Electron on purpose. An ElectronAppAdapter needs the app, and
// what is under test is the updater's own feed handling, not the window: the
// adapter below is the smallest one DebUpdater reads, and requests go through
// node's http instead of Electron's net.
//
// Usage: node scripts/probe-linux-updater.cjs [--version <v>] [--owner <o>] [--repo <r>]
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const EXTENSIONS = [
  { extension: '.deb', updater: 'DebUpdater' },
  { extension: '.AppImage', updater: 'AppImageUpdater' },
];
const DEFAULTS = { owner: 'earenbaz80', repo: 'omni-commander' };

/** HttpExecutor is abstract: the one it wants is Electron's net, this is node's. */
class NodeHttpExecutor extends require('builder-util-runtime').HttpExecutor {
  createRequest(options, callback) {
    const module = options.protocol === 'http:' ? http : https;
    return module.request(options, callback);
  }
}

/**
 * The updater reads four facts off the app it belongs to: its version, its name
 * (for the sudo prompt), whether it is packaged, and two cache directories.
 *
 * It also reads the `app-update.yml` the package ships, and not only at startup:
 * an update that is offered prepares the download helper, which loads that file
 * again. Without it a feed newer than the tree -- a dispatch on a branch behind
 * the release, which is the case the version check below is here to report --
 * fails with ERR_INVALID_ARG_TYPE before the check can say what it found.
 */
function appAdapter(version, cacheDir, { owner, repo } = DEFAULTS) {
  const appUpdateConfigPath = path.join(cacheDir, 'app-update.yml');
  fs.writeFileSync(
    appUpdateConfigPath,
    `provider: github\nowner: ${owner}\nrepo: ${repo}\nupdaterCacheDirName: omni-updater-probe\n`,
  );
  return {
    version,
    name: 'OmniCommander Pro',
    isPackaged: true,
    userDataPath: cacheDir,
    baseCachePath: cacheDir,
    appUpdateConfigPath,
    whenReady: async () => {},
    quit: () => {},
    relaunch: () => {},
  };
}

function parseArgs(argv) {
  const options = { version: require('../package.json').version, ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--version') options.version = argv[(index += 1)];
    else if (flag === '--owner') options.owner = argv[(index += 1)];
    else if (flag === '--repo') options.repo = argv[(index += 1)];
  }
  return options;
}

function feedError(error) {
  const code = error.code ? `${error.code}: ` : '';
  const firstLine = String(error.message ?? error).split('\n')[0];
  return `${code}${firstLine}`;
}

async function probe({ version, owner, repo }) {
  const { DebUpdater } = require('electron-updater');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-updater-'));

  // No feed in the constructor: the provider keeps the executor it is built
  // with, and a DebUpdater created with an adapter gets none, so the URL is set
  // after the node executor is in place.
  const updater = new DebUpdater(null, appAdapter(version, cacheDir, { owner, repo }));
  updater.logger = { info() {}, warn() {}, error() {} };
  updater.httpExecutor = new NodeHttpExecutor();
  // `@internal`, and the only way to pin the platform: the channel name carries
  // it, and a check that asked for the Windows `latest.yml` on a Linux runner
  // would pass for the wrong file the day it ran on another host.
  updater._testOnlyOptions = { platform: 'linux' };
  updater.setFeedURL({ provider: 'github', owner, repo });

  let result;
  try {
    result = await updater.checkForUpdates();
  } catch (error) {
    throw new Error(`the updater found no Linux feed: ${feedError(error)}`);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  if (result == null) throw new Error('the updater is not active, so it never asked the feed');

  const info = result.updateInfo;
  if (info.version !== version) {
    throw new Error(
      `the feed offers ${info.version} while package.json says ${version}; this tree is not the newest cut`,
    );
  }

  const files = info.files ?? [];
  const offered = [];
  for (const { extension, updater: consumer } of EXTENSIONS) {
    const entry = files.find((file) => file.url.toLowerCase().endsWith(extension.toLowerCase()));
    if (!entry) {
      throw new Error(
        `the channel of ${info.version} offers no ${extension} to ${consumer}: ${files.map((file) => file.url).join(', ') || 'no files'}`,
      );
    }
    if (entry.sha512 == null)
      throw new Error(`the channel names ${entry.url} without a sha512, which the updater refuses`);
    offered.push({ ...entry, consumer });
  }
  return { version: info.version, files: offered };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { version, files } = await probe(options);
  console.log(`the updater read latest-linux.yml of ${version}`);
  for (const file of files)
    console.log(`  ${file.url}: ${file.size} bytes, sha512:${file.sha512.slice(0, 16)}... offered to ${file.consumer}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}

module.exports = { NodeHttpExecutor, appAdapter, probe };
