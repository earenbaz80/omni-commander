// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The sh sampler reads the process table with `ps -A -o pid=,comm=,rss=,time=`
 * and parses `[[dd-]hh:]mm:ss` into centiseconds. Both are platform formats,
 * and a column that arrives one field over would not crash: it would produce
 * deltas of zero, and the hook would attach a verdict saying nobody was using
 * the machine. So the run below is against the real `ps` of whatever system
 * this is, and a burner makes sure the numbers have to be non-zero.
 *
 * Where `ps` does not answer those flags -- the MSYS one on Windows, which is
 * where this repository's CI runs -- the sampler is not used by the hook at
 * all, and what matters is the contract that keeps it out: a non-zero exit and
 * a message, never an empty summary that reads like a quiet box.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, 'cpu-sampler.sh');

const psAnswers = (() => {
  const probe = spawnSync('ps', ['-A', '-o', 'pid=,comm=,rss=,time='], { encoding: 'utf8', timeout: 10000 });
  return probe.status === 0 && (probe.stdout ?? '').trim().length > 0;
})();

function runSampler(args: string[]) {
  return spawnSync('sh', [scriptPath, ...args], { encoding: 'utf8', timeout: 60000 });
}

describe.runIf(psAnswers)('cpu-sampler.sh against this system ps', () => {
  it('reads real CPU numbers and names the process that burned them', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cpu-sampler-'));
    const out = path.join(dir, 'samples.log');
    // Long enough to be sampled, short enough that it cannot outlive the test.
    const burner = spawn(process.execPath, ['-e', 'const end = Date.now() + 15000; while (Date.now() < end);'], {
      stdio: 'ignore',
    });

    try {
      // A window here costs its `ps` spawn plus a second, so the deadline buys
      // fewer rows than seconds; five was enough to leave this test on the edge
      // of its own assertion on a loaded machine.
      const result = runSampler(['--seconds', '8', '--out', out]);
      expect(result.status, result.stderr).toBe(0);

      const lines = readFileSync(out, 'utf8').trim().split('\n');
      expect(lines[0]).toBe('ts,freeMb,totalCs,top');
      const rows = lines.slice(1);
      // One pass is the warm-up, which must not produce a row: attributing the
      // whole lifetime of a process to the first window was a bug once.
      expect(rows.length).toBeGreaterThanOrEqual(2);

      for (const row of rows) {
        const [, , totalCs, top] = row.split(',');
        expect(totalCs).toMatch(/^\d+$/);
        for (const entry of top.split(';').filter(Boolean)) {
          // `name=pid=cs=wsMb`, the shape the PowerShell twin also writes.
          expect(entry).toMatch(/^[^=;]+=\d+=\d+=\d+$/);
        }
      }

      // Something did work while the sampler watched, and it was named: a
      // misaligned time column parses without error and yields nothing here.
      expect(rows.some((row) => Number(row.split(',')[2]) > 0)).toBe(true);
      const names = rows
        .flatMap((row) => row.split(',')[3].split(';'))
        .filter(Boolean)
        .map((entry) => entry.split('=')[0]);
      expect(names).toContain('node');

      expect(result.stdout).toMatch(/^\d+ ventanas de ~1s; CPU por nombre de proceso:$/m);
      // Decimal point, not comma: the sampler pins LC_ALL for this.
      expect(result.stdout).toMatch(/^node\s+\d+\.\d{2} nucleos medios\s+\d+ s de CPU\s+pico\s+\d+ MB$/m);
    } finally {
      burner.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe.runIf(!psAnswers)('cpu-sampler.sh where ps cannot answer those flags', () => {
  it('exits non-zero with a reason instead of an empty verdict', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cpu-sampler-'));
    try {
      const result = runSampler(['--seconds', '3', '--out', path.join(dir, 'samples.log')]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/ps could not list processes/);
      // The hook prints this file as "CPU by process name while the suite ran",
      // so it must not carry numbers it never measured.
      expect(result.stdout).not.toMatch(/nucleos medios/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
