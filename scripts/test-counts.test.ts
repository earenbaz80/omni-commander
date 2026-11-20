// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// CommonJS so the workflow can run it with plain `node`; the test loads the same
// module the CLI runs.
const loadCjs = createRequire(import.meta.url);
const { countsFrom, dirtyTests, formatNumber, patchDoc, testsChangedSince, unnamedTests } = loadCjs(
  './test-counts.cjs',
) as {
  dirtyTests: (status: string) => string[];
  formatNumber: (value: number) => string;
  countsFrom: (report: Report) => Counts;
  patchDoc: (
    text: string,
    counts: Counts,
    commit: string,
  ) => { text: string; updated: string[]; kept: string[]; missing: string[]; named: string[] };
  unnamedTests: (counts: Counts, named: Set<string>, changed: string[]) => { file: string; cases: number }[];
  testsChangedSince: (root?: string) => { tag: string; files: string[] } | null;
};

interface Report {
  numPassedTests: number;
  numPendingTests: number;
  numTotalTests: number;
  testResults: { name: string; assertionResults: unknown[] }[];
}

interface Counts {
  passed: number;
  skipped: number;
  total: number;
  files: Record<string, number>;
}

const cases = (count: number) => Array.from({ length: count }, () => ({}));

const report: Report = {
  numPassedTests: 1563,
  numPendingTests: 9,
  numTotalTests: 1572,
  testResults: [
    { name: '/repo/scripts/previous-release.test.ts', assertionResults: cases(11) },
    { name: '/repo/scripts/probe-linux-updater.test.ts', assertionResults: cases(8) },
  ],
};

// The numbers the notes quote come from vitest's report, so this reads that
// report the way the tests paragraph needs them: three totals and a count per
// file, keyed by basename because the report carries absolute paths.
describe('the counts a run reports', () => {
  it('keeps the numbers the paragraph quotes apart', () => {
    expect(countsFrom(report)).toEqual({
      passed: 1563,
      skipped: 9,
      total: 1572,
      files: { 'previous-release.test.ts': 11, 'probe-linux-updater.test.ts': 8 },
    });
  });

  it('writes thousands with the separator the notes use', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1572)).toBe('1 572');
    expect(formatNumber(12345)).toBe('12 345');
  });
});

// The doc is prose with numbers in it; only the numbers are rewritten, and the
// prose around them is the part nobody wants a script editing.
describe('rewriting the numbers in a release note', () => {
  const doc = [
    'La suite cerró en **1 568 passed, 9 skipped de 1 577**, medidos en `0591322`.',
    'Los ficheros nuevos o ampliados son',
    '`scripts/previous-release.test.ts` (8 casos sobre el selector) y',
    '`scripts/probe-linux-updater.test.ts` (7 casos: la elección de canal).',
  ].join('\n');
  const commit = 'e241ed8';

  it('updates the totals, the files and the commit, and nothing else', () => {
    const patched = patchDoc(doc, countsFrom(report), commit);

    expect(patched.text).toBe(
      [
        'La suite cerró en **1 563 passed, 9 skipped de 1 572**, medidos en `e241ed8`.',
        'Los ficheros nuevos o ampliados son',
        '`scripts/previous-release.test.ts` (11 casos sobre el selector) y',
        '`scripts/probe-linux-updater.test.ts` (8 casos: la elección de canal).',
      ].join('\n'),
    );
    expect(patched.updated).toEqual([
      'scripts/previous-release.test.ts: 8 -> 11 casos',
      'scripts/probe-linux-updater.test.ts: 7 -> 8 casos',
      'the suite: **1 568 passed, 9 skipped de 1 577** -> **1 563 passed, 9 skipped de 1 572**',
      'the commit: 0591322 -> e241ed8',
    ]);
    expect(patched.missing).toEqual([]);
  });

  it('reports what already matched instead of writing the same file twice', () => {
    const patched = patchDoc(patchDoc(doc, countsFrom(report), commit).text, countsFrom(report), commit);

    expect(patched.updated).toEqual([]);
    expect(patched.kept).toHaveLength(4);
  });

  // A file the doc counts that the run never produced means the prose and the tree
  // have separated; leaving the number alone is the only honest answer.
  it('names a counted file the run has no results for', () => {
    const patched = patchDoc(doc.replace('probe-linux-updater.test.ts', 'gone.test.ts'), countsFrom(report), commit);

    expect(patched.missing).toEqual(['scripts/gone.test.ts']);
    expect(patched.text).toContain('`scripts/gone.test.ts` (7 casos: la elección de canal).');
  });

  // Both halves of the sentence are load-bearing: without the totals there is
  // nothing to place, and without the commit the note would describe "today"
  // again -- the thing that kept ageing it.
  it('refuses a doc it cannot place: no totals, or no commit', () => {
    expect(() =>
      patchDoc('Los ficheros nuevos son `scripts/previous-release.test.ts` (11 casos).', countsFrom(report), commit),
    ).toThrow(/quotes no "N passed, N skipped de N" sentence/);
    expect(() =>
      patchDoc('La suite cerró en **1 563 passed, 9 skipped de 1 572**.', countsFrom(report), commit),
    ).toThrow(/does not say which commit the numbers were measured at/);
  });
});

// The numbers come from the working tree; the commit that gets stamped is the last
// one, which does not contain that tree. A note naming it would describe a suite
// with other counts, so the run has to stop instead.
describe('telling whether the measured tree is the committed one', () => {
  it('picks out the test files the tree has changed, and only those', () => {
    const status = [
      ' M scripts/probe-linux-updater.test.ts',
      '?? scripts/test-counts.test.ts',
      ' D scripts/gone.test.tsx',
      ' M docs/releases/1.0.53.md',
      ' M scripts/test-counts.cjs',
      ' M README.md',
    ].join('\n');

    expect(dirtyTests(status)).toEqual([
      'scripts/probe-linux-updater.test.ts',
      'scripts/test-counts.test.ts',
      'scripts/gone.test.tsx',
    ]);
  });

  it('finds nothing to complain about in a tree whose tests are all committed', () => {
    expect(dirtyTests('')).toEqual([]);
    expect(dirtyTests(' M docs/releases/1.0.53.md\n M scripts/test-counts.cjs\n')).toEqual([]);
  });
});

// The list of files in the note is written by hand, so a test added while the
// release is prepared can be counted and still be missing from it. The run can
// tell which files are new -- the ones HEAD has added since the last release --
// and naming them with their counts is the reminder the paragraph needs.
describe('warning about a test file the note leaves out', () => {
  const newer: Report = {
    numPassedTests: 19,
    numPendingTests: 0,
    numTotalTests: 19,
    testResults: [
      { name: '/repo/scripts/previous-release.test.ts', assertionResults: cases(11) },
      { name: '/repo/scripts/test-counts.test.ts', assertionResults: cases(8) },
    ],
  };

  it('names the counted file added since the last release that the doc omits', () => {
    expect(
      unnamedTests(countsFrom(newer), new Set(['scripts/previous-release.test.ts']), [
        'scripts/previous-release.test.ts',
        'scripts/test-counts.test.ts',
        'scripts/not-in-the-run.test.ts',
      ]),
    ).toEqual([{ file: 'scripts/test-counts.test.ts', cases: 8 }]);
  });

  it('stays quiet when the new files are either named or not counted', () => {
    const counts = countsFrom(newer);

    expect(
      unnamedTests(counts, new Set(['scripts/previous-release.test.ts', 'scripts/test-counts.test.ts']), [
        'scripts/test-counts.test.ts',
      ]),
    ).toEqual([]);
    expect(unnamedTests(counts, new Set(), ['scripts/not-in-the-run.test.ts'])).toEqual([]);
  });

  // "New or expanded" is what the note promises, so a file the branch touched
  // belongs in the list even when it was there before the last release: the cases
  // it already had are not the reason to name it, the ones added to it are.
  it('counts a test file the branch expanded, not only the ones it added', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-counts-git-'));
    const git = (...args: string[]) => {
      const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(run.stderr).trim()}`);
    };

    try {
      git('init', '-q');
      git('config', 'user.email', 'tests@example.com');
      git('config', 'user.name', 'Tests');
      git('config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(dir, 'old.test.ts'), "it('first', () => {});\n");
      git('add', '.');
      git('commit', '-qm', 'first');
      git('tag', 'v1.0.0');
      fs.writeFileSync(path.join(dir, 'old.test.ts'), "it('first', () => {});\nit('second', () => {});\n");
      git('commit', '-qam', 'expand the tests');

      expect(testsChangedSince(dir)).toEqual({ tag: 'v1.0.0', files: ['old.test.ts'] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
