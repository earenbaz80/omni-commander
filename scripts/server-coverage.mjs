#!/usr/bin/env node
/**
 * Measures what the server half of the suite actually exercises.
 *
 * `server.cjs` runs as a child process in every server suite, so the coverage
 * vitest reports for `src/**` can never see it: V8 only describes the process it
 * runs in. The harness passes `process.env` to that child, so setting
 * NODE_V8_COVERAGE here makes each server dump its own coverage, and this script
 * adds those dumps up.
 *
 * The conversion is block-level V8 coverage mapped to lines, not istanbul branch
 * coverage: it answers "which lines of the server did a test reach", which is the
 * number the roadmap needs before touching 4 700 lines. It is deliberately
 * dependency-free -- the alternative was adding a converter to measure a file.
 *
 * The rule that matters is nesting. V8 reports a function as one range and the
 * blocks inside it as smaller ones, so a block that never ran sits *inside* a
 * function that did, with `count: 0`. Painting a function's whole range as
 * covered therefore reports 100 % for a file where half the branches never ran.
 * The smallest range that reaches a line is the one that decides.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const rawDir = path.join(root, 'server-coverage-raw');
const outDir = path.join(root, 'server-coverage');

const suites = fs
  .readdirSync(root)
  .filter((name) => /^server\..*\.test\.ts$/.test(name))
  .sort();

if (suites.length === 0) {
  console.error('No server suites found (server.*.test.ts).');
  process.exit(1);
}

fs.rmSync(rawDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });

console.log(`Running ${suites.length} server suites with NODE_V8_COVERAGE...`);
const started = Date.now();
const run = spawnSync('npx', ['vitest', 'run', ...suites], {
  stdio: 'inherit',
  shell: true,
  // Also tells the harness and the server that this run wants the dump.
  env: { ...process.env, NODE_V8_COVERAGE: rawDir, SERVER_COVERAGE_SHUTDOWN: '1' },
});

if (run.status !== 0) {
  // A red suite still measured something; stopping here would throw that away.
  console.error(`\nThe server suites exited with ${run.status}; summarising what ran anyway.\n`);
}

const isServerScript = (url) => {
  if (!url.startsWith('file:')) return false;
  const file = fileURLToPath(url);
  const normalised = file.split(path.sep).join('/');
  return /\/server\.cjs$/.test(normalised) || /\/server\/.+\.cjs$/.test(normalised);
};

/** Offsets of the first character of every line, for offset -> line without splitting per range. */
const lineStarts = (source) => {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
};

const lineAt = (starts, offset) => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
};

/** file -> { starts, ranges: Map('start:end' -> count), functions: Map } merged over every process. */
const scripts = new Map();
const dumps = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((name) => name.endsWith('.json')) : [];

for (const dump of dumps) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(rawDir, dump), 'utf8'));
  } catch {
    continue;
  }
  for (const script of data.result || []) {
    if (!isServerScript(script.url)) continue;
    const file = fileURLToPath(script.url);
    if (!scripts.has(file)) {
      scripts.set(file, { starts: lineStarts(fs.readFileSync(file, 'utf8')), ranges: new Map(), functions: new Map() });
    }
    const entry = scripts.get(file);
    for (const fn of script.functions || []) {
      const ranges = fn.ranges || [];
      const identity = `${fn.functionName || '<module>'}@${ranges[0]?.startOffset ?? 0}`;
      const hit = (ranges[0]?.count ?? 0) > 0;
      entry.functions.set(identity, entry.functions.get(identity) === true || hit);
      for (const range of ranges) {
        // The same block appears in every process that loaded the file; it counts
        // as reached if any of them ran it.
        const key = `${range.startOffset}:${range.endOffset}`;
        entry.ranges.set(key, Math.max(entry.ranges.get(key) ?? 0, range.count));
      }
    }
  }
}

const pct = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
const summary = { generatedAt: new Date().toISOString(), suites: suites.length, files: {}, total: null };
let totalLines = 0;
let coveredLines = 0;
let totalFunctions = 0;
let coveredFunctions = 0;

const measured = [...scripts.keys()].sort().map((file) => {
  const entry = scripts.get(file);
  const ranges = [...entry.ranges.entries()]
    .map(([key, count]) => {
      const [start, end] = key.split(':').map(Number);
      return { start, end, count, length: end - start };
    })
    .sort((a, b) => a.length - b.length);

  const counts = new Map();
  for (const range of ranges) {
    const first = lineAt(entry.starts, range.start);
    const last = lineAt(entry.starts, range.end);
    for (let line = first; line <= last; line++) if (!counts.has(line)) counts.set(line, range.count);
  }

  const covered = [...counts.values()].filter((count) => count > 0).length;
  const lines = counts.size;
  const fnTotal = entry.functions.size;
  const fnCovered = [...entry.functions.values()].filter(Boolean).length;
  totalLines += lines;
  coveredLines += covered;
  totalFunctions += fnTotal;
  coveredFunctions += fnCovered;
  return { file, covered, lines, fnTotal, fnCovered };
});

console.log('');
for (const { file, covered, lines, fnTotal, fnCovered } of measured) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  summary.files[relative] = {
    lines: { covered, total: lines, pct: pct(covered, lines) },
    functions: { covered: fnCovered, total: fnTotal, pct: pct(fnCovered, fnTotal) },
  };
  console.log(
    `${relative.padEnd(24)} ${String(covered).padStart(6)} / ${String(lines).padStart(6)} líneas (${pct(covered, lines)} %)  ·  ${fnCovered}/${fnTotal} funciones`,
  );
}

if (measured.length === 0) {
  console.error(`No coverage dumps named server.cjs were found in ${path.basename(rawDir)}.`);
  process.exit(1);
}

summary.total = {
  lines: { covered: coveredLines, total: totalLines, pct: pct(coveredLines, totalLines) },
  functions: { covered: coveredFunctions, total: totalFunctions, pct: pct(coveredFunctions, totalFunctions) },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log('');
console.log(
  `Servidor: ${summary.total.lines.pct} % de líneas (${coveredLines}/${totalLines}), ${summary.total.functions.pct} % de funciones (${coveredFunctions}/${totalFunctions})`,
);
console.log(
  `Informe en ${path.relative(root, path.join(outDir, 'summary.json'))} · ${Math.round((Date.now() - started) / 1000)}s`,
);
