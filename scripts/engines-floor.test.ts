// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The script is CommonJS (it runs straight from `node scripts/engines-floor.cjs`
// in CI), so load it the way Node would instead of relying on ESM interop.
const loadCjs = createRequire(import.meta.url);
const { floorOf } = loadCjs('./engines-floor.cjs') as { floorOf: (range?: string) => string };

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, 'engines-floor.cjs');

describe('floorOf', () => {
  it('reads the floor of the range the project declares', () => {
    expect(floorOf('^22.22.2 || ^24.15.0 || >=26.0.0')).toBe('22.22.2');
  });

  it('accepts every bound shape it advertises', () => {
    expect(floorOf('24.15.0')).toBe('24.15.0');
    expect(floorOf('=22.22.2')).toBe('22.22.2');
    expect(floorOf('>=24.15.0')).toBe('24.15.0');
    expect(floorOf('~22.22.2')).toBe('22.22.2');
    expect(floorOf('^22.13.0')).toBe('22.13.0');
  });

  it('returns the smallest alternative, not the first one written', () => {
    expect(floorOf('^24.15.0 || ^22.22.2')).toBe('22.22.2');
  });

  it('ignores surrounding whitespace', () => {
    expect(floorOf('  ^22.22.2   ||   >=26.0.0  ')).toBe('22.22.2');
  });

  it.each(['22.x', '<24', '*', 'latest', '^22.22.2 || *'])('refuses %s instead of guessing a floor', (range) => {
    expect(() => floorOf(range)).toThrow(/does not start with a version/);
  });

  it.each(['', '   ', undefined])('refuses %j because there is no range', (range) => {
    expect(() => floorOf(range)).toThrow(/no floor to read/);
  });
});

describe('engines-floor.cjs CLI', () => {
  it('prints the floor of the real package.json and exits clean', () => {
    const { engines } = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };

    const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(floorOf(engines?.node));
  });
});
