#!/usr/bin/env node
/**
 * Prints the lowest Node version that satisfies `engines.node` in package.json.
 *
 * The CI matrix has to install a concrete version, and copying the floor by hand
 * drifts from the declaration it is supposed to test. This is deliberately not a
 * semver implementation: it reads the only shapes the range uses (caret, tilde,
 * `>=` and exact versions joined by `||`) and rejects anything else, so an
 * unsupported range can never quietly report a floor that is not the real
 * minimum.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ALTERNATIVE = /^(?:\^|~|>=|=)?\s*(\d+)\.(\d+)\.(\d+)$/;

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Lowest version satisfying `range`, e.g. `^22.22.2 || ^24.15.0` -> `22.22.2`.
 * Throws with a readable reason when the range has no version as lower bound.
 */
function floorOf(range) {
  const declared = String(range == null ? '' : range).trim();
  if (!declared) {
    throw new Error('engines.node is empty or missing, so there is no floor to read.');
  }

  // In every supported shape the lower bound of an alternative is the version it
  // names, so the floor of the whole range is the smallest of those bounds.
  const floors = declared.split('||').map((alternative) => {
    const named = alternative.trim();
    const match = ALTERNATIVE.exec(named);
    if (!match) {
      throw new Error(
        `Cannot read a floor from engines.node ${JSON.stringify(declared)}: ` +
          `${JSON.stringify(named)} does not start with a version. ` +
          'Use caret, tilde, >= or exact versions joined by ||.',
      );
    }
    return match.slice(1).map(Number);
  });

  const floor = floors.reduce((lowest, current) => (compare(current, lowest) < 0 ? current : lowest));
  return floor.join('.');
}

function main() {
  const { engines } = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  try {
    console.log(floorOf(engines && engines.node));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { floorOf };
