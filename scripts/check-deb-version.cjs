#!/usr/bin/env node
// Checks that the `.deb` carries the version this tree claims, accepting the
// spelling Debian requires.
//
// A Debian version cannot carry a hyphen, so electron-builder writes the semver
// prerelease with `~` -- 1.0.53-beta.1 becomes 1.0.53~beta.1, which sorts before
// the release. Both workflows compared the control field with the semver string
// once and both went red on a correct package, the tag on v1.0.53-beta.1 and the
// preflight on the same cut. The rule lives here so there is one spelling and
// one message, and neither workflow can drift from it.
//
// Usage: node scripts/check-deb-version.cjs <package.deb> [--version <v>]
// Without --version the expected version comes from package.json.
const { execFileSync } = require('node:child_process');

const FIELDS = ['Package', 'Version', 'Maintainer'];

/** The same version written the way a Debian control file can carry it. */
function debianSpelling(version) {
  return version.replace('-', '~');
}

/** Both spellings are this version; anything else is a package from elsewhere. */
function accepts(version, actual) {
  return actual === version || actual === debianSpelling(version);
}

function controlFields(deb) {
  return execFileSync('dpkg-deb', ['-f', deb, ...FIELDS], { encoding: 'utf8' }).trim();
}

function controlVersion(deb) {
  return execFileSync('dpkg-deb', ['-f', deb, 'Version'], { encoding: 'utf8' }).trim();
}

function main(argv) {
  const [deb] = argv;
  const asked = argv.indexOf('--version');
  const expected = asked >= 0 ? argv[asked + 1] : require('../package.json').version;

  console.log(controlFields(deb));
  const actual = controlVersion(deb);
  if (!accepts(expected, actual)) {
    throw new Error(`the .deb reports version ${actual}, package.json says ${expected}`);
  }
  console.log(`the .deb carries ${actual} for ${expected}`);
}

if (require.main === module) {
  const [deb] = process.argv.slice(2);
  if (!deb || deb.startsWith('--')) {
    console.error('usage: check-deb-version.cjs <package.deb> [--version <v>]');
    process.exit(2);
  }
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { FIELDS, accepts, controlFields, controlVersion, debianSpelling };
