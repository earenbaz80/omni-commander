const os = require('node:os');

/**
 * Live system load: the CPU and RAM readings the info drawer shows.
 *
 * The drawer used to print fixed numbers ("14% (16 cores)", "16.4 GB / 64 GB")
 * that described no machine. os.loadavg() is always [0, 0, 0] on Windows and the
 * CPU time counters are cumulative since boot, so a percentage only exists as
 * the difference between two readings: one snapshot is kept module-wide, and a
 * caller that arrives before any window has passed waits it out instead of
 * reporting a bogus 0%.
 *
 * The logic is here rather than in the route so it can be exercised without
 * starting the server; the readings are the same ones the route has always
 * served.
 */

const CPU_WINDOW_MS = 300;

// Identical to the server's own helper: the wait is part of the measurement, so
// it has to live with it.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total, at: Date.now() };
}

let cpuTimes = readCpuTimes();
// Last real measurement, kept so two requests landing in the same instant still
// get the previous load instead of null.
let lastCpuPercent = null;

async function readSystemStats() {
  const since = Date.now() - cpuTimes.at;
  if (since < CPU_WINDOW_MS) await sleep(CPU_WINDOW_MS - since);

  const previous = cpuTimes;
  const current = readCpuTimes();
  cpuTimes = current;

  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta > 0) {
    lastCpuPercent = Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
  }

  // os.freemem() is memory that is available without swapping (libuv reads
  // ullAvailPhys on Windows), so the difference against total is what the OS
  // itself reports as in use.
  const totalRam = os.totalmem();
  return {
    cores: os.cpus().length,
    cpuPercent: lastCpuPercent,
    ramTotalBytes: totalRam,
    ramUsedBytes: Math.max(0, totalRam - os.freemem()),
  };
}

module.exports = { readSystemStats };
