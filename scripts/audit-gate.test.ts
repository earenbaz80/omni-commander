// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// The gate is CommonJS so the workflow can run it with plain `node`, which is
// also how the exceptions are read in production.
const loadCjs = createRequire(import.meta.url);
const { advisoriesOf, evaluate, todayOf } = loadCjs('./audit-gate.cjs') as {
  advisoriesOf: (report: unknown) => Array<{ id: string; package: string; severity: string; title: string }>;
  evaluate: (
    report: unknown,
    exceptions: Exception[],
    today: string,
  ) => {
    unexcepted: Array<{ id: string; package: string }>;
    excepted: Array<{ id: string; package: string; exception: Exception }>;
    expired: Array<{ id: string; package: string; exception: Exception }>;
    stale: Exception[];
  };
  todayOf: (clock?: Date) => string;
};

interface Exception {
  id: string;
  package: string;
  severity: string;
  reviewed: string;
  expires: string;
  reason: string;
}

/** The shape `npm audit --json` uses, cut down to the fields the gate reads. */
const auditReport = (vulnerabilities: Record<string, unknown>) => ({ vulnerabilities, metadata: {} });

const advisory = (name: string, severity = 'high') => ({
  name,
  severity,
  title: `${name} has a problem`,
  url: `https://github.com/advisories/GHSA-aaaa-bbbb-${name}`,
});

const exception = (over: Partial<Exception> = {}): Exception => ({
  id: 'GHSA-AAAA-BBBB-PICOMATCH',
  package: 'picomatch',
  severity: 'high',
  reviewed: '2026-11-18',
  expires: '2027-02-18',
  reason: 'no published fix, build tooling only',
  ...over,
});

const picomatchTree = auditReport({
  picomatch: { severity: 'high', via: [advisory('picomatch')] },
  // The dependent borrows the severity and lists the cause by name only.
  fdir: { severity: 'high', via: ['picomatch'] },
});

describe('advisoriesOf', () => {
  it('reports one advisory per cause instead of one per dependent', () => {
    expect(advisoriesOf(picomatchTree)).toEqual([
      { id: 'GHSA-AAAA-BBBB-PICOMATCH', package: 'picomatch', severity: 'high', title: 'picomatch has a problem' },
    ]);
  });

  it('leaves the levels the gate does not watch alone', () => {
    const report = auditReport({ deepmerge: { severity: 'low', via: [advisory('deepmerge', 'low')] } });
    expect(advisoriesOf(report)).toEqual([]);
  });

  it('reads a report with no vulnerabilities at all', () => {
    expect(advisoriesOf({ vulnerabilities: {}, metadata: {} })).toEqual([]);
  });
});

describe('evaluate', () => {
  it('lets a live exception cover its advisory', () => {
    const verdict = evaluate(picomatchTree, [exception()], '2026-11-18');
    expect(verdict.unexcepted).toEqual([]);
    expect(verdict.expired).toEqual([]);
    expect(verdict.excepted.map((entry) => entry.id)).toEqual(['GHSA-AAAA-BBBB-PICOMATCH']);
  });

  it('keeps an advisory with no exception red', () => {
    const verdict = evaluate(picomatchTree, [], '2026-11-18');
    expect(verdict.unexcepted).toEqual([
      { id: 'GHSA-AAAA-BBBB-PICOMATCH', package: 'picomatch', severity: 'high', title: 'picomatch has a problem' },
    ]);
  });

  it('turns an advisory red again once its exception has expired', () => {
    const verdict = evaluate(picomatchTree, [exception({ expires: '2027-02-18' })], '2027-02-19');
    expect(verdict.unexcepted).toEqual([]);
    expect(verdict.expired).toHaveLength(1);
    expect(verdict.excepted).toEqual([]);
    // Expired is its own failure, not also an unused entry.
    expect(verdict.stale).toEqual([]);
  });

  it('does not let an exception for another package cover it', () => {
    const verdict = evaluate(picomatchTree, [exception({ package: 'fdir' })], '2026-11-18');
    expect(verdict.unexcepted).toHaveLength(1);
  });

  it('reports an exception nothing matches without failing on it', () => {
    const verdict = evaluate(auditReport({}), [exception()], '2026-11-18');
    expect(verdict.stale.map((entry) => entry.id)).toEqual(['GHSA-AAAA-BBBB-PICOMATCH']);
    expect(verdict.unexcepted).toEqual([]);
    expect(verdict.expired).toEqual([]);
  });
});

describe('todayOf', () => {
  it('dates in UTC, the unit the exceptions are written in', () => {
    expect(todayOf(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-18');
    expect(todayOf(new Date('2026-11-19T00:30:00Z'))).toBe('2026-11-19');
  });
});
