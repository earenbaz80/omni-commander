#!/usr/bin/env node
/**
 * Points Git at `.githooks/` so the commit and push hooks run. Invoked from the
 * `prepare` lifecycle, so `npm install` on a fresh clone wires them up.
 *
 * Everything here is best-effort: installing the package from a tarball, inside
 * a container without Git, or from a `npm ci` that only needs to build must not
 * fail because a developer convenience could not be set up.
 */
const { execFileSync } = require('node:child_process');
const { chmodSync, existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hooksDir = path.join(root, '.githooks');

function tryRun(args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Not a checkout (tarball, Docker build, CI without .git): nothing to wire.
if (!existsSync(hooksDir) || !tryRun(['rev-parse', '--git-dir'])) {
  process.exit(0);
}

if (!tryRun(['config', 'core.hooksPath', '.githooks'])) {
  console.warn('Git hooks not enabled: could not set core.hooksPath.');
  process.exit(0);
}

// Git only runs hooks carrying the executable bit on POSIX systems. Windows
// ignores the bit, so a failure here is not worth failing the install over.
for (const hook of readdirSync(hooksDir)) {
  try {
    chmodSync(path.join(hooksDir, hook), 0o755);
  } catch {
    /* mode already set, or a filesystem without POSIX permissions */
  }
}

console.log(
  'Git hooks enabled: commits format what they touch, pushes check documentation links, types, tests and the e2e smoke subset.',
);
