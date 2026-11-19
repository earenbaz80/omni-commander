// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CommonJS so both workflows can run it with plain `node`, which is how they
// invoke it in the packaging steps.
const loadCjs = createRequire(import.meta.url);
const { accepts, debianSpelling } = loadCjs('./check-deb-version.cjs') as {
  accepts: (version: string, actual: string) => boolean;
  debianSpelling: (version: string) => string;
};
const packageVersion = (loadCjs('../package.json') as { version: string }).version;

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-deb-version.cjs');

describe('the version a .deb may carry', () => {
  it('writes a prerelease the way Debian can: the hyphen becomes a tilde', () => {
    expect(debianSpelling('1.0.53-beta.1')).toBe('1.0.53~beta.1');
    expect(debianSpelling('1.0.52')).toBe('1.0.52');
  });

  // Both spellings went through this check on purpose: the tag and the preflight
  // each went red once on a correct prerelease package before it accepted both.
  it.each([
    ['1.0.53-beta.1', '1.0.53~beta.1', true],
    ['1.0.53-beta.1', '1.0.53-beta.1', true],
    ['1.0.52', '1.0.52', true],
    ['1.0.53-beta.1', '1.0.52', false],
    ['1.0.53-beta.1', '9.9.9', false],
    ['1.0.52', '1.0.52~1', false],
  ])('%s accepts %s: %s', (version, actual, expected) => {
    expect(accepts(version as string, actual as string)).toBe(expected);
  });
});

// The workflows run the file itself, so the exit codes and the messages that
// turn a red job into a readable one get their own test. `dpkg-deb` only exists
// on the runners, so a preload replaces it with the control fields this test
// chooses; the rest of the script runs untouched.
function runCheck(controlVersion: string, args: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deb-version-'));
  const preload = path.join(dir, 'fake-dpkg-deb.cjs');
  fs.writeFileSync(
    preload,
    [
      "const cp = require('node:child_process');",
      `const version = ${JSON.stringify(controlVersion)};`,
      "const values = { Package: 'omnicommander-pro', Version: version };",
      'cp.execFileSync = (_file, args) => {',
      '  const fields = args.slice(2);',
      '  return fields.length === 1',
      '    ? values[fields[0]]',
      "    : fields.map((field) => field + ': ' + values[field]).join('\\n');",
      '};',
      '',
    ].join('\n'),
  );
  try {
    return spawnSync(process.execPath, ['-r', preload, CHECK, ...args], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the check as the workflows run it', () => {
  it('exits 1 and names both versions when the package is from another tree', () => {
    const result = runCheck('9.9.9', ['release/OmniCommander-Pro-9.9.9-amd64.deb']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Version: 9.9.9');
    expect(result.stderr).toContain(`::error::the .deb reports version 9.9.9, package.json says ${packageVersion}`);
  });

  it.each([
    ['no argument', []],
    ['two arguments', ['release/a.deb', 'release/b.deb']],
    // The flag is gone: the expected version always comes from package.json, and
    // the old spelling of the call must fail instead of being read as a path.
    ['the removed --version flag', ['--version', '1.0.52']],
  ])('exits 2 with the usage when given %s', (_case, args) => {
    const result = runCheck(packageVersion, args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: check-deb-version.cjs <package.deb>');
    expect(result.stdout).toBe('');
  });
});
