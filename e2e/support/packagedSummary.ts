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

class PackagedSummary implements Reporter {
  private rows: string[] = [];
  private failures: string[] = [];
  private reasons: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const name = test.titlePath().filter(Boolean).slice(1).join(' > ');
    const passed = result.status === 'passed';
    this.rows.push(`| ${name} | ${passed ? 'passed' : `**${result.status}**`} | ${Math.round(result.duration)} ms |`);
    if (!passed) {
      this.failures.push(name);
      // The first failures say why the run broke; the rest usually repeat it. A
      // log is not readable from the API, an annotation is.
      const reason = (result.error?.message ?? '').trim();
      if (reason && this.reasons.length < 3) this.reasons.push(reason.slice(0, 600));
    }
  }

  onEnd(): void {
    const markdown = [
      `### Packaged app e2e: ${this.rows.length - this.failures.length} of ${this.rows.length} cases passed`,
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
