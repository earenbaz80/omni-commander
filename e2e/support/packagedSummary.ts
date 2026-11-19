/**
 * Puts the packaged run's verdict on the run page.
 *
 * Playwright's list reporter writes to a log that GitHub truncates and that
 * nobody keeps once the run is gone; the step summary is what survives. Every
 * case is listed with its status, and the failed ones also go out as a single
 * `::error::` line, because an annotation is readable through the API when the
 * log is not.
 */
import { appendFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** How much of the failure list an annotation carries before it is cut. */
const ANNOTATION_LIMIT = 900;

/**
 * The statuses that are a finding. `skipped` is not one: the suite marks its
 * Windows-only cases that way, and a Linux run of it skips most of them, which
 * is the specs saying they do not apply here rather than the package failing.
 */
const FINDINGS = new Set(['failed', 'timedOut', 'interrupted']);

interface Outcome {
  name: string;
  status: string;
  duration: number;
}

class PackagedSummary implements Reporter {
  /** One entry per test: a retry replaces the attempt it repeated. */
  private outcomes = new Map<string, Outcome>();
  private reasons: string[] = [];
  private seen = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const name = test.titlePath().filter(Boolean).slice(1).join(' > ');
    this.outcomes.set(test.id, { name, status: result.status, duration: result.duration });

    if (FINDINGS.has(result.status)) {
      // A log is not readable from the API and an annotation is, so the run says
      // why it broke. One message per distinct cause: sixty-nine copies of the
      // same fixture error would hide the second reason.
      const reason = (result.error?.message ?? '').trim();
      const signature = reason.slice(0, 80);
      if (reason && !this.seen.has(signature) && this.reasons.length < 6) {
        this.seen.add(signature);
        this.reasons.push(reason.slice(0, 700));
      }
    }
  }

  onEnd(): void {
    const all = [...this.outcomes.values()];
    const failures = all.filter((outcome) => FINDINGS.has(outcome.status));
    const skipped = all.filter((outcome) => outcome.status !== 'passed' && !FINDINGS.has(outcome.status));
    const passed = all.length - failures.length - skipped.length;

    const markdown = [
      `### Packaged app e2e: ${passed} passed, ${failures.length} failed, ${skipped.length} skipped of ${all.length}`,
      '',
      '| case | result | time |',
      '| --- | --- | --- |',
      ...all.map((outcome) => {
        const shown =
          outcome.status === 'passed' ? 'passed' : FINDINGS.has(outcome.status) ? `**${outcome.status}**` : 'skipped';
        return `| ${outcome.name} | ${shown} | ${Math.round(outcome.duration)} ms |`;
      }),
      ...(failures.length ? ['', 'Failed:', ...failures.map((outcome) => `- ${outcome.name}`)] : []),
    ].join('\n');

    const file = process.env.GITHUB_STEP_SUMMARY;
    if (file) {
      try {
        appendFileSync(file, `${markdown}\n`);
      } catch {
        // The step's own guard reports a summary it could not read.
      }
    }

    // A pass leaves no trace in the API, and a run that collected no tests at all
    // would otherwise look exactly like one that passed: say how many ran.
    console.log(
      `::notice::packaged e2e: ${passed} passed, ${failures.length} failed, ${skipped.length} skipped of ${all.length}`,
    );

    if (failures.length) {
      const list = failures
        .map((outcome) => outcome.name)
        .join(', ')
        .slice(0, ANNOTATION_LIMIT);
      console.log(`::error::packaged e2e failed ${failures.length} case(s): ${list}`);
      for (const reason of this.reasons) {
        const flat = reason.replaceAll('%', '%25').replaceAll('\r', '').replaceAll('\n', ' ');
        console.log(`::error::first failures: ${flat}`);
      }
    }
  }
}

export default PackagedSummary;
