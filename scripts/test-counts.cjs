#!/usr/bin/env node
// Prints the test counts a release note quotes, measured from a real run, and
// rewrites them in place with `--write`.
//
// The numbers kept going stale because they were typed by hand from a run whose
// output nobody kept: a test added anywhere moves the total, and the note went on
// saying otherwise until somebody noticed. The suite already reports them in a
// form a machine reads, so this asks for that report instead of counting by eye.
//
// Only the numbers move. Which files are named and why each one exists stays as
// written, and a file the doc counts that the run did not produce is an error
// rather than a silent zero -- that is the case where the prose and the tree have
// separated, and rewriting the number would hide it.
//
// The list is still written by hand, so the run looks at it from the other side
// too: a test file it counted that the doc does not name, when HEAD has added,
// expanded or renamed that file since the last release, is a line the note is
// missing -- the drift that hides behind a total which still matches.
//
// The sentence also names the commit whose tree was measured. That is what keeps
// the note from ageing: it describes that commit, so a test added afterwards does
// not make it wrong. `--write` stamps `HEAD`, which is the tree it just measured,
// but only when a number or a counted test changed since the note's stamp: a
// commit that only touches documentation cannot move either, and re-stamping on
// it would make the note chase its own commit forever.
//
// Usage: node scripts/test-counts.cjs [--doc <file>] [--write]
// Without `--doc` it lists every file's case count; `--write` needs one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Not `require.resolve`: vitest's exports map does not expose the bin, and this is
// the same entry `npx vitest` runs.
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/** `1 572`: the separator the release notes use, not a locale's. */
function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The numbers the tests paragraph quotes, out of vitest's JSON report. Files are
 * keyed by basename because the report carries absolute paths and the doc names
 * them from the repository root.
 */
function countsFrom(report) {
  const files = {};
  for (const result of report.testResults ?? []) {
    files[path.basename(result.name)] = (result.assertionResults ?? []).length;
  }
  return {
    passed: report.numPassedTests ?? 0,
    skipped: report.numPendingTests ?? 0,
    total: report.numTotalTests ?? 0,
    files,
  };
}

/** `**1 563 passed, 9 skipped de 1 572**`, the one sentence that carries all three. */
function summaryLine(counts) {
  return `**${formatNumber(counts.passed)} passed, ${formatNumber(counts.skipped)} skipped de ${formatNumber(counts.total)}**`;
}

const SUMMARY = /\*\*[\d ]+ passed, [\d ]+ skipped de [\d ]+\*\*/;
const MEASURED_AT = /(medidos en `)([0-9a-f]{7,40})(`)/;
// Any `` `scripts/x.test.ts` (N casos `` in the doc: the number in front of the
// prose is the only part this owns. The gap is `\s+` because the paragraph wraps,
// and a path that ends a line opens the parenthesis on the next one.
const COUNTED_FILE = /(`([^`]+\.test\.tsx?)`\s+\()(\d+)( casos)/g;

/** The commit the doc says its numbers were measured at. */
function measuredAtOf(text) {
  const found = MEASURED_AT.exec(text);
  if (found == null) throw new Error('the doc does not say which commit the numbers were measured at');
  return found[2];
}

/** Rewrites the numbers in `text`; returns what changed, what already matched,
 * what the run could not answer for and which files the doc names, which is what
 * the list check needs. The commit is left alone: whether it is still current
 * needs the git history, which is the caller's to read. */
function patchDoc(text, counts) {
  const updated = [];
  const kept = [];
  const missing = [];
  const named = [];

  const patched = text.replace(COUNTED_FILE, (match, prefix, file, current, suffix) => {
    named.push(file);
    const measured = counts.files[path.basename(file)];
    if (measured == null) {
      missing.push(file);
      return match;
    }
    if (measured === Number(current)) {
      kept.push(`${file}: ${current} casos`);
      return match;
    }
    updated.push(`${file}: ${current} -> ${measured} casos`);
    return `${prefix}${measured}${suffix}`;
  });

  const found = SUMMARY.exec(patched);
  if (found == null) {
    throw new Error('the doc quotes no "N passed, N skipped de N" sentence');
  }
  const summary = summaryLine(counts);
  if (found[0] === summary)
    kept.push(
      `the suite: ${formatNumber(counts.passed)} passed, ${formatNumber(counts.skipped)} skipped de ${formatNumber(counts.total)}`,
    );
  else updated.push(`the suite: ${found[0]} -> ${summary}`);
  const stamped = patched.replace(found[0], summary);

  return {
    text: stamped,
    updated,
    kept,
    missing,
    named,
    measuredAt: measuredAtOf(stamped),
  };
}

/** Whether the note's stamp has aged: the numbers moved, or a counted test
 * changed after the measurement. A commit that only touches documentation cannot
 * move either, so the commit that adds the note must not make its own stamp
 * stale -- otherwise every note commit would ask to be re-stamped forever. */
function stampIsStale(measuredAt, commit, countsChanged, root = ROOT) {
  if (measuredAt === commit) return false;
  return countsChanged || testsChangedSince(measuredAt, commit, root).length > 0;
}

/**
 * The counted test files the doc does not name, out of the ones HEAD has added,
 * expanded or renamed since the last release. A test that has been in the tree for
 * releases belongs to no note's list, but one the branch has touched since the last
 * tag is exactly what a list of new or expanded files is supposed to mention:
 * leaving it out is the drift nobody notices, because the total still matches.
 */
function unnamedTests(counts, named, changed) {
  return changed
    .filter((file) => counts.files[path.basename(file)] != null && !named.has(file))
    .map((file) => ({ file, cases: counts.files[path.basename(file)] }));
}

/** The release a note is about, taken from its file name: `1.0.50-beta.1` still
 * belongs to the 1.0.50 line, and a name that is not a version has no window. */
function noteVersion(doc) {
  const match = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(path.basename(doc, '.md'));
  return match == null ? null : match[1];
}

/** The release tag just before `version`: the base the note's list is measured
 * from. A published note keeps its own release's window instead of sliding
 * forward to the next tag, and a prerelease is not a base of its own. */
function previousRelease(tags, version) {
  const [major, minor, patch] = version.split('.').map(Number);
  const earlier = tags
    .map((tag) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag))
    .filter((match) => match != null)
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])])
    .filter(([a, b, c]) => a < major || (a === major && (b < minor || (b === minor && c < patch))))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const last = earlier.at(-1);
  return last == null ? null : `v${last.join('.')}`;
}

/** The test files the working tree has changed. */
function dirtyTests(status) {
  return status
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((file) => /\.test\.tsx?$/.test(file));
}

/** The numbers come from the working tree, but the commit they are stamped with
 * would not contain it: the note would name a tree whose suite has other counts. */
function assertMeasuredTreeIsCommitted() {
  const run = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`git could not describe the tree: ${(run.stderr ?? '').trim()}`);
  const dirty = dirtyTests(run.stdout);
  if (dirty.length) {
    throw new Error(
      `uncommitted test changes: ${dirty.join(', ')}; the suite counts them but the commit it stamps does not contain them`,
    );
  }
}

/** The commit whose tree the numbers describe. */
function headCommit() {
  const run = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git could not name HEAD: ${(run.stderr ?? '').trim()}`);
  return run.stdout.trim();
}

/** The release tags the checkout has, for picking the note's base. */
function releaseTags(root = ROOT) {
  const run = spawnSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git could not list the tags: ${(run.stderr ?? '').trim()}`);
  return run.stdout.split('\n').filter(Boolean);
}

/** The test files added, expanded or renamed between two commits: the window the
 * note's list is written against, not everything the branch has done since. */
function testsChangedSince(base, end, root = ROOT) {
  const run = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=AMR', `${base}..${end}`, '--', '*.test.ts', '*.test.tsx'],
    { cwd: root, encoding: 'utf8' },
  );
  if (run.status !== 0) {
    throw new Error(`git could not compare the tests between ${base} and ${end}: ${(run.stderr ?? '').trim()}`);
  }
  return run.stdout.split('\n').filter(Boolean);
}

/** Asks the suite for its report: the numbers come from the run, not from a guess. */
function measure() {
  if (!fs.existsSync(VITEST)) throw new Error(`vitest is not installed; run npm ci first`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-counts-'));
  const reportPath = path.join(dir, 'report.json');
  try {
    const run = spawnSync(process.execPath, [VITEST, 'run', '--reporter=json', `--outputFile=${reportPath}`], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
      encoding: 'utf8',
    });
    if (!fs.existsSync(reportPath)) throw new Error(`the suite wrote no report (node exited ${run.status})`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!report.success) {
      throw new Error(`the suite did not pass: ${report.numFailedTests} failed of ${report.numTotalTests}`);
    }
    return countsFrom(report);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { doc: null, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--doc') options.doc = argv[(index += 1)];
    else if (flag === '--write') options.write = true;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.write && options.doc == null) throw new Error('--write needs --doc <file>');

  assertMeasuredTreeIsCommitted();
  const counts = measure();
  const commit = headCommit();
  console.log(
    `the suite: ${formatNumber(counts.passed)} passed, ${formatNumber(counts.skipped)} skipped de ${formatNumber(counts.total)}, measured at ${commit}`,
  );

  if (options.doc == null) {
    for (const [name, cases] of Object.entries(counts.files).sort()) console.log(`  ${name}: ${cases} casos`);
    return;
  }

  const docPath = path.resolve(ROOT, options.doc);
  const {
    text: patched,
    updated,
    kept,
    missing,
    named,
    measuredAt,
  } = patchDoc(fs.readFileSync(docPath, 'utf8'), counts);
  if (missing.length) {
    throw new Error(`the run has no results for ${missing.join(', ')}, which ${options.doc} counts`);
  }
  // The stamp is the commit whose tree was measured. Moving it on every commit
  // would make the note chase its own history: only a changed number or a counted
  // test makes the measurement describe a tree other than HEAD.
  const countsChanged = updated.length > 0;
  let text = patched;
  if (measuredAt === commit) kept.push(`the commit: ${commit}`);
  else if (stampIsStale(measuredAt, commit, countsChanged)) {
    updated.push(`the commit: ${measuredAt} -> ${commit}`);
    text = text.replace(MEASURED_AT, `$1${commit}$3`);
  } else kept.push(`the commit: ${measuredAt}`);
  const version = noteVersion(options.doc);
  const base = version == null ? null : previousRelease(releaseTags(), version);
  const changed = base == null ? [] : testsChangedSince(base, options.write ? commit : measuredAt);
  for (const line of kept) console.log(`kept ${line}`);
  for (const line of updated) console.log(`${options.write ? 'changed' : 'would change'} ${line}`);
  if (base == null) console.log(`no release tag before ${version ?? options.doc}; the note's list was not checked`);
  for (const { file, cases } of unnamedTests(counts, new Set(named), changed)) {
    console.log(`unnamed ${file}: ${cases} casos, changed since ${base} and not named in ${options.doc}`);
  }
  if (!updated.length) console.log(`${options.doc} already quotes these numbers`);
  else if (options.write) fs.writeFileSync(docPath, text);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  countsFrom,
  dirtyTests,
  formatNumber,
  measuredAtOf,
  noteVersion,
  patchDoc,
  previousRelease,
  stampIsStale,
  summaryLine,
  testsChangedSince,
  unnamedTests,
};
