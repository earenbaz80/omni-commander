import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the real Electron app with `TRAY_PROBE=1`, injects two parked transfers,
 * opens the native tray menu and checks that apply-to-all belongs to each job.
 *
 * The main process answers with one JSON line; this script is what decides
 * whether the run passes. It needs the built renderer (`npm run build`) and a
 * desktop session where a tray icon can exist.
 */

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/index.html is missing: run `npm run build` before the tray probe.');
  process.exit(1);
}

const EXPECTED = {
  initial: { job_a: false, job_b: false },
  afterA: { job_a: true, job_b: false },
  afterB: { job_a: true, job_b: true },
  afterAOff: { job_a: false, job_b: true },
};

const child = spawn(electron, ['.'], {
  cwd: root,
  env: { ...process.env, TRAY_PROBE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => {
  child.kill();
  console.error('The tray probe did not answer within 45 seconds.');
  console.error(stderr.slice(-2000));
  process.exitCode = 1;
}, 45000);

child.on('close', (code) => {
  clearTimeout(timeout);
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('TRAY_PROBE_RESULT '));
  if (!line) {
    console.error(`The tray probe exited without a result (code ${code}).`);
    console.error(stdout.slice(-2000));
    console.error(stderr.slice(-2000));
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = JSON.parse(line.slice('TRAY_PROBE_RESULT '.length));
  } catch (error) {
    console.error(`The tray probe result is not JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    assert.equal(result.ok, true, result.error);
    assert.equal(result.rows.length, 2, 'the menu must draw one row per park');
    assert.deepEqual(
      result.rows.map((row) => row.id),
      ['answer:job_a', 'answer:job_b'],
    );
    assert.deepEqual(result.initial, EXPECTED.initial);
    assert.deepEqual(result.afterA, EXPECTED.afterA);
    assert.deepEqual(result.afterB, EXPECTED.afterB);
    assert.deepEqual(result.afterAOff, EXPECTED.afterAOff);
    assert.deepEqual(result.sets.initial, []);
    assert.deepEqual(result.sets.afterA, ['job_a']);
    assert.deepEqual(result.sets.afterB, ['job_a', 'job_b']);
    assert.deepEqual(result.sets.afterAOff, ['job_b']);
    assert.equal(result.menuOpened, true);
  } catch (error) {
    console.error('Tray probe failed:');
    console.error(error.message);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log('Tray probe passed.');
  console.log(`  rows: ${result.rows.map((row) => row.label).join(' | ')}`);
  console.log(`  initial: ${JSON.stringify(result.initial)}`);
  console.log(`  after job_a: ${JSON.stringify(result.afterA)}`);
  console.log(`  after job_b: ${JSON.stringify(result.afterB)}`);
  console.log(`  after unticking job_a: ${JSON.stringify(result.afterAOff)}`);
});
