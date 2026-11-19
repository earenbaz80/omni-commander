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

class PackagedSummary implements Reporter {
  private rows: string[] = [];
  private failures: string[] = [];
  private skipped = 0;
  private reasons: string[] = [];
  private seen = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const name = test.titlePath().filter(Boolean).slice(1).join(' > ');
    const isFinding = FINDINGS.has(result.status);
    const shown = result.status === 'passed' ? 'passed' : isFinding ? `**${result.status}**` : 'skipped';
    this.rows.push(`| ${name} | ${shown} | ${Math.round(result.duration)} ms |`);
    if (!isFinding && result.status !== 'passed') this.skipped += 1;
    if (isFinding) {
      this.failures.push(name);
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
    // A pass leaves no trace in the API, and a run that collected no tests at all
    // would otherwise look exactly like one that passed: say how many ran.
    const passed = this.rows.length - this.failures.length - this.skipped;
    console.log(
      `::notice::packaged e2e: ${passed} passed, ${this.failures.length} failed, ${this.skipped} skipped of ${this.rows.length}`,
    );

    const markdown = [
      `### Packaged app e2e: ${passed} passed, ${this.failures.length} failed, ${this.skipped} skipped of ${this.rows.length}`,
      '',
      '| case | result | time |',
      '| --- | --- | --- |',
      ...this.rows,
      ...(this.failures.length ? ['', 'Failed:', ...this.failures.map((name) => `- ${name}`)] : []),
    ].join('\n');

    const file = process.env.GITHUB_STEP_SUMMARY;
    if (file) {
      try {
        appendFileSync(file, `${markdown}\n`);
      } catch {
        // The step's own guard reports a summary it could not read.
      }
    }

    if (this.failures.length) {
      const list = this.failures.join(', ').slice(0, ANNOTATION_LIMIT);
      console.log(`::error::packaged e2e failed ${this.failures.length} case(s): ${list}`);
      for (const reason of this.reasons) {
        const flat = reason.replaceAll('%', '%25').replaceAll('\r', '').replaceAll('\n', ' ');
        console.log(`::error::first failures: ${flat}`);
      }
    }
  }
}

export default PackagedSummary;
