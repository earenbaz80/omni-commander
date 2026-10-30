#!/usr/bin/env node
/**
 * Fails when the dev server watches the folder the packaging build owns.
 *
 * electron-builder extracts Electron into `release/win-unpacked.tmp` and renames
 * it into place afterwards. With `npm run dev` running, the dev server had that
 * folder under its watcher and kept handles open on the files it had just
 * written, so on Windows the rename failed with EPERM and a local
 * `npm run electron:build` could not finish. Removing the rule that keeps the
 * folder out of the watcher brought the failure back once already, so this fails
 * the run instead of mentioning it.
 *
 * It reads the real config through Vite rather than scanning vite.config.ts, so
 * the check follows whatever the file actually exports.
 */
const path = require('node:path');

// Files the packaging build creates: the staging folder it renames, the
// unpacked app inside it, and the update metadata next to the installer.
const SAMPLE_FILES = [
  'release/win-unpacked.tmp/LICENSES.chromium.html',
  'release/win-unpacked/OmniCommander Pro.exe',
  'release/latest.yml',
];

async function main() {
  const { resolveConfig } = await import('vite');
  const config = await resolveConfig({}, 'serve', 'development');
  const ignored = config.server && config.server.watch ? config.server.watch.ignored : undefined;

  // Vite accepts a single value or a list, and functions or regexes cannot be
  // checked against a path without running them, so they are not counted.
  const rules = (Array.isArray(ignored) ? ignored : ignored ? [ignored] : []).filter(
    (rule) => typeof rule === 'string',
  );

  const watched = SAMPLE_FILES.filter((file) => !rules.some((rule) => path.matchesGlob(file, rule)));
  if (watched.length === 0) {
    console.log('The dev server leaves the packaging output alone, so a local build can finish while it runs.');
    return;
  }

  console.error(
    `::error file=vite.config.ts::The dev server watches the packaging output (${watched.join(', ')}). ` +
      'A local electron-builder run will then fail with EPERM while renaming release/win-unpacked.tmp; ' +
      "add the packaging folder to server.watch.ignored, e.g. ['**/release/**'].",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  // The check cannot confirm anything without the config, and a green run that
  // checked nothing is worse than a red one.
  console.error(`::error file=vite.config.ts::Could not read the Vite config to check the watcher: ${error.message}`);
  process.exitCode = 1;
});
