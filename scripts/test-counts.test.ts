// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// CommonJS so the workflow can run it with plain `node`; the test loads the same
// module the CLI runs.
const loadCjs = createRequire(import.meta.url);
const { countsFrom, formatNumber, patchDoc } = loadCjs('./test-counts.cjs') as {
  formatNumber: (value: number) => string;
  countsFrom: (report: Report) => Counts;
  patchDoc: (text: string, counts: Counts) => { text: string; updated: string[]; kept: string[]; missing: string[] };
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
    'La suite cerró en **1 568 passed, 9 skipped de 1 577** con el árbol de estas',
    'notas. Los ficheros nuevos o ampliados son',
    '`scripts/previous-release.test.ts` (8 casos sobre el selector) y',
    '`scripts/probe-linux-updater.test.ts` (7 casos: la elección de canal).',
  ].join('\n');

  it('updates the totals and every file the doc counts, and nothing else', () => {
    const patched = patchDoc(doc, countsFrom(report));

    expect(patched.text).toBe(
      [
        'La suite cerró en **1 563 passed, 9 skipped de 1 572** con el árbol de estas',
        'notas. Los ficheros nuevos o ampliados son',
        '`scripts/previous-release.test.ts` (11 casos sobre el selector) y',
        '`scripts/probe-linux-updater.test.ts` (8 casos: la elección de canal).',
      ].join('\n'),
    );
    expect(patched.updated).toEqual([
      'scripts/previous-release.test.ts: 8 -> 11 casos',
      'scripts/probe-linux-updater.test.ts: 7 -> 8 casos',
      'the suite: **1 568 passed, 9 skipped de 1 577** -> **1 563 passed, 9 skipped de 1 572**',
    ]);
    expect(patched.missing).toEqual([]);
  });

  it('reports what already matched instead of writing the same file twice', () => {
    const patched = patchDoc(patchDoc(doc, countsFrom(report)).text, countsFrom(report));

    expect(patched.updated).toEqual([]);
    expect(patched.kept).toHaveLength(3);
  });

  // A file the doc counts that the run never produced means the prose and the tree
  // have separated; leaving the number alone is the only honest answer.
  it('names a counted file the run has no results for', () => {
    const patched = patchDoc(doc.replace('probe-linux-updater.test.ts', 'gone.test.ts'), countsFrom(report));

    expect(patched.missing).toEqual(['scripts/gone.test.ts']);
    expect(patched.text).toContain('`scripts/gone.test.ts` (7 casos: la elección de canal).');
  });

  it('refuses a doc that quotes no totals at all', () => {
    expect(() =>
      patchDoc('Los ficheros nuevos son `scripts/previous-release.test.ts` (11 casos).', countsFrom(report)),
    ).toThrow(/quotes no "N passed, N skipped de N" sentence/);
  });
});
