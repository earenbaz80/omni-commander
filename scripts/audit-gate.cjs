#!/usr/bin/env node
/**
 * The full dependency audit, with dated exceptions.
 *
 * `npm audit --audit-level=high` goes red on any high advisory, including one
 * that has no release to move to. The step had two bad options -- fail every
 * push, or drop to `--omit=dev` and stop watching the toolchain -- so such an
 * advisory is listed in `.github/audit-exceptions.json` with the date it was
 * reviewed and the date it stops counting, and everything else at that level
 * stays red. An exception that outlives its expiry fails the gate, and one that
 * no longer matches an advisory is reported as unused, so the list cannot
 * quietly grow into a permanent allow.
 *
 * The advisories are still npm's answer: this runs the same audit and reads its
 * JSON, rather than keeping a second opinion about what is vulnerable.
 */
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EXCEPTIONS_FILE = path.join(ROOT, '.github', 'audit-exceptions.json');

/** The levels that fail the gate. `moderate` and below are read, not gated. */
const GATED = new Set(['high', 'critical']);

/** Today as `YYYY-MM-DD` in UTC, which is the unit the exceptions are dated in. */
function todayOf(clock = new Date()) {
  return clock.toISOString().slice(0, 10);
}

/**
 * The reviewed exceptions, with every field a string so a malformed file fails
 * on the comparison below instead of on a type nobody expected.
 */
function readExceptions(file = EXCEPTIONS_FILE) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.exceptions;
  if (!Array.isArray(list)) throw new Error(`${path.basename(file)} has no exceptions array`);
  return list.map((entry) => ({
    id: String((entry && entry.id) || '').toUpperCase(),
    package: String((entry && entry.package) || ''),
    severity: String((entry && entry.severity) || '').toLowerCase(),
    reviewed: String((entry && entry.reviewed) || ''),
    expires: String((entry && entry.expires) || ''),
    reason: String((entry && entry.reason) || ''),
  }));
}

/**
 * The advisories npm reports at the gated levels, one per advisory and package.
 *
 * npm nests them: a package that is only vulnerable because another one is lists
 * that other package by name in `via`, and the advisory itself hangs off the
 * package it belongs to. Reading the objects out of `via` gives one entry per
 * advisory instead of one per dependent, which is what an exception names.
 */
function advisoriesOf(report) {
  const found = new Map();
  const vulnerabilities = report && report.vulnerabilities ? report.vulnerabilities : {};
  for (const name of Object.keys(vulnerabilities)) {
    const entry = vulnerabilities[name] || {};
    for (const via of Array.isArray(entry.via) ? entry.via : []) {
      if (!via || typeof via !== 'object') continue;
      const severity = String(via.severity || entry.severity || '').toLowerCase();
      if (!GATED.has(severity)) continue;
      const url = String(via.url || '');
      const match = url.match(/GHSA-[a-z\d-]+/i);
      const id = (match ? match[0] : String(via.source || '')).toUpperCase();
      const packageName = String(via.name || name);
      found.set(`${id} ${packageName}`, {
        id,
        package: packageName,
        severity,
        title: String(via.title || ''),
      });
    }
  }
  return [...found.values()];
}

/**
 * Splits the gated advisories into the ones an exception covers and the ones it
 * does not, and reports the exceptions that were not needed.
 *
 * An exception covers an advisory by id and package, and only until its
 * `expires` date: an expired one turns its advisory back into a blocker with
 * its own message, so the fix is a review rather than a silent extension. An
 * exception nothing matches is stale -- the dependency moved, or the advisory
 * was withdrawn -- and is reported without failing, because a bump is allowed
 * to clean up after itself.
 */
function evaluate(report, exceptions, today) {
  const advisories = advisoriesOf(report);
  const unexcepted = [];
  const excepted = [];
  const expired = [];
  const used = new Set();

  for (const advisory of advisories) {
    const matches = exceptions.filter(
      (entry) => entry.id === advisory.id && (!entry.package || entry.package === advisory.package),
    );
    if (matches.length === 0) {
      unexcepted.push(advisory);
      continue;
    }
    const live = matches.find((entry) => entry.expires >= today);
    if (live) {
      used.add(live);
      excepted.push({ ...advisory, exception: live });
      continue;
    }
    // Matched but out of date: it is the expiry that fails the run, not an
    // unused entry, so it must not also be reported as stale.
    for (const entry of matches) used.add(entry);
    expired.push({ ...advisory, exception: matches[0] });
  }

  const stale = exceptions.filter((entry) => !used.has(entry));
  return { advisories, unexcepted, excepted, expired, stale };
}

/**
 * `npm audit --json`, whose exit code is 1 whenever it finds something.
 *
 * The command is a literal run through a shell rather than an argument list:
 * `npm` is `npm.cmd` on Windows, which needs the shell, and passing arguments
 * alongside one is deprecated for exactly the reason there are none here.
 */
function auditReport() {
  const options = { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    return JSON.parse(execSync('npm audit --json', options));
  } catch (error) {
    const printed = error && error.stdout ? String(error.stdout) : '';
    try {
      return JSON.parse(printed);
    } catch {
      const why = error && error.stderr ? String(error.stderr).trim() : String(error && error.message);
      throw new Error(`the audit could not be read, so nothing was checked: ${why}`);
    }
  }
}

function main(argv = process.argv.slice(2), options = {}) {
  const todayFlag = argv.find((arg) => arg.startsWith('--today='));
  const today = todayFlag ? todayFlag.slice('--today='.length) : todayOf();

  const report = options.report || auditReport();
  const exceptions = options.exceptions || readExceptions();
  const { unexcepted, excepted, expired, stale } = evaluate(report, exceptions, today);

  for (const entry of excepted) {
    console.log(`excepted  ${entry.id}  ${entry.package}  ${entry.severity}`);
    console.log(`          reviewed ${entry.exception.reviewed}, expires ${entry.exception.expires}`);
    console.log(`          ${entry.exception.reason}`);
  }
  for (const entry of stale) {
    console.log(`unused    ${entry.id}  ${entry.package}: nothing matches it any more, so it can go.`);
  }
  for (const entry of expired) {
    console.error(
      `expired   ${entry.id}  ${entry.package}: reviewed ${entry.exception.reviewed}, ` +
        `exception ended ${entry.exception.expires}. Review the advisory and move the date.`,
    );
  }
  for (const entry of unexcepted) {
    console.error(`blocking  ${entry.id}  ${entry.package}  ${entry.severity}: ${entry.title}`);
  }

  const blockers = unexcepted.length + expired.length;
  if (blockers > 0) {
    const count = blockers === 1 ? '1 advisory' : `${blockers} advisories`;
    const verb = blockers === 1 ? 'is' : 'are';
    console.error(`\n${count} at high or critical ${verb} not covered by a live exception.`);
    return 1;
  }
  console.log(`No unexcepted high or critical advisory on ${today}, ${excepted.length} excepted.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 2;
  }
}

module.exports = { advisoriesOf, evaluate, main, readExceptions, todayOf };
