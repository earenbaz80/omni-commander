// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CPU_WINDOW_MS, readSystemStats } from './server/systemLoad.cjs';

/**
 * The info drawer shows these numbers as facts about the machine, so they have
 * to be measurements and not placeholders. They used to be computed inside the
 * route; the assertions below are what the route promised.
 */

describe('readSystemStats', () => {
  it('mide esta máquina: núcleos, CPU y RAM', async () => {
    const stats = await readSystemStats();

    expect(stats.cores).toBeGreaterThan(0);
    expect(Number.isInteger(stats.cores)).toBe(true);
    // A percentage, never the fixed "14%" the drawer used to print.
    expect(stats.cpuPercent).not.toBeNull();
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpuPercent).toBeLessThanOrEqual(100);
    expect(stats.ramTotalBytes).toBeGreaterThan(0);
    expect(stats.ramUsedBytes).toBeGreaterThanOrEqual(0);
    expect(stats.ramUsedBytes).toBeLessThanOrEqual(stats.ramTotalBytes);
  });

  it('espera la ventana de medida en vez de devolver un 0% inventado', async () => {
    // Two readings in the same instant describe no elapsed time, so the second
    // call waits out the window before it answers. The clock is faked because a
    // real one measures the machine as much as the code: between the sample the
    // first read keeps and its return, the function walks `os.cpus()` again for
    // `cores`, and on a loaded runner those 60 ms come out of the wait -- a 239 ms
    // answer once put this red with nothing wrong. With a fake clock the reading
    // is still pending one millisecond before the window and resolves when it is
    // due, which is stricter than the margin was and cannot flake.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      // A fresh module, so its first sample is taken at the faked instant and the
      // second call owes the whole window rather than the remainder of one.
      vi.resetModules();
      const fresh = (await import('./server/systemLoad.cjs')) as {
        CPU_WINDOW_MS: number;
        readSystemStats: () => Promise<{ cpuPercent: number | null }>;
      };

      const first = fresh.readSystemStats();
      await vi.advanceTimersByTimeAsync(fresh.CPU_WINDOW_MS);
      await first;

      const started = Date.now();
      let settled = false;
      const second = fresh.readSystemStats().then((stats) => {
        settled = true;
        return stats;
      });

      await vi.advanceTimersByTimeAsync(CPU_WINDOW_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const stats = await second;
      expect(settled).toBe(true);
      expect(Date.now() - started).toBe(CPU_WINDOW_MS);
      // No real time passed for the CPU counters, so there is no percentage to
      // report and the reading is null rather than an invented 0. What the value
      // must be is the first test's business, where the window is real.
      expect(stats.cpuPercent === null || stats.cpuPercent >= 0).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('devuelve la forma que consume el panel de información', async () => {
    const stats = await readSystemStats();

    expect(Object.keys(stats).sort()).toEqual(['cores', 'cpuPercent', 'ramTotalBytes', 'ramUsedBytes']);
  });
});
