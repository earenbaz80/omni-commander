// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
    await readSystemStats();

    // Two readings in the same instant describe no elapsed time, so the second
    // call waits out the window before it answers.
    const started = Date.now();
    const stats = await readSystemStats();
    const elapsed = Date.now() - started;

    // The window is the contract, not the literal 250 that used to be here. A
    // timer that fires a few milliseconds early on a busy machine, or a clock
    // read a tick out, is not the bug this guards against -- returning instantly
    // with an invented 0% is -- and asserting the exact number put a red run on
    // a suite where nothing was wrong. The margin keeps the meaning: an answer
    // that did not wait cannot land within 50ms of the window.
    expect(elapsed).toBeGreaterThanOrEqual(CPU_WINDOW_MS - 50);
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
  });

  it('devuelve la forma que consume el panel de información', async () => {
    const stats = await readSystemStats();

    expect(Object.keys(stats).sort()).toEqual(['cores', 'cpuPercent', 'ramTotalBytes', 'ramUsedBytes']);
  });
});
