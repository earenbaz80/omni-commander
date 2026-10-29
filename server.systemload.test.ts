// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readSystemStats } from './server/systemLoad.cjs';

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

    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
  });

  it('devuelve la forma que consume el panel de información', async () => {
    const stats = await readSystemStats();

    expect(Object.keys(stats).sort()).toEqual(['cores', 'cpuPercent', 'ramTotalBytes', 'ramUsedBytes']);
  });
});
