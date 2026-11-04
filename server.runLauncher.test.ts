// @vitest-environment node
import os from 'node:os';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { registerRunRoutes } from './server/runLauncher.cjs';

/**
 * The rules of the Run box, described without a server and without a window.
 *
 * The routes themselves are proven over HTTP in `server.open.test.ts`,
 * `server.run.test.ts`, `server.run.suggestions.test.ts` and
 * `server.openWith.test.ts`; what is left here is the part that is pure text and
 * paths — how a line becomes argv, what a name means, and how a path is quoted
 * into the elevation script — which is exactly the part that is cheapest to get
 * wrong and hardest to see when it is.
 */

const routes: string[] = [];
const app = {
  get: (route: string) => routes.push(`GET ${route}`),
  post: (route: string) => routes.push(`POST ${route}`),
} as unknown as Express;

const helpers = registerRunRoutes(app, {});
const {
  splitCommandLine,
  expandRunEnvVars,
  looksLikeWebAddress,
  shellFolderAlias,
  scriptArgv,
  describeResolvedFile,
  buildElevationScript,
  startProcessArg,
} = helpers as {
  splitCommandLine: (text: string) => string[];
  expandRunEnvVars: (value: string) => string;
  looksLikeWebAddress: (value: string) => boolean;
  shellFolderAlias: (name: string) => string | null;
  scriptArgv: (file: string, args: string[]) => string[];
  describeResolvedFile: (file: string, args: string[]) => { kind: string; target: string; argv: string[] };
  buildElevationScript: (file: string, args: string[]) => string;
  startProcessArg: (value: string) => string;
};

describe('registerRunRoutes', () => {
  it('registers the three routes of the Run box', () => {
    expect(routes).toEqual(['POST /api/open', 'POST /api/run', 'GET /api/run/suggestions']);
  });
});

describe('splitCommandLine', () => {
  it('keeps a quoted path whole and takes the rest as arguments', () => {
    expect(splitCommandLine('"C:\\Program Files\\app.exe" --flag "a b"')).toEqual([
      'C:\\Program Files\\app.exe',
      '--flag',
      'a b',
    ]);
  });

  it('leaves shell operators inside arguments instead of treating them as syntax', () => {
    expect(splitCommandLine('cmd.exe /c "echo a & del b"')).toEqual(['cmd.exe', '/c', 'echo a & del b']);
  });

  it('refuses an unbalanced quote instead of guessing where it ends', () => {
    expect(() => splitCommandLine('"C:\\Program Files\\app.exe')).toThrow(/Unterminated/);
  });
});

describe('expandRunEnvVars', () => {
  it('expands the names the environment knows, in any case', () => {
    process.env.OMNI_LAUNCHER_PROBE = 'C:\\probe';
    expect(expandRunEnvVars('%omni_launcher_probe%\\file.txt')).toBe('C:\\probe\\file.txt');
    delete process.env.OMNI_LAUNCHER_PROBE;
  });

  it('leaves an unknown name alone so it fails as a path instead of pointing at the cwd', () => {
    expect(expandRunEnvVars('%OMNI_NOT_A_VARIABLE%\\x')).toBe('%OMNI_NOT_A_VARIABLE%\\x');
  });
});

describe('looksLikeWebAddress', () => {
  it('accepts a host with a real top-level domain, a port or localhost', () => {
    expect(looksLikeWebAddress('google.com')).toBe(true);
    expect(looksLikeWebAddress('example.com:8080/x?y')).toBe(true);
    expect(looksLikeWebAddress('localhost:3000')).toBe(true);
  });

  it('refuses a file name, a drive-letter path and a space', () => {
    expect(looksLikeWebAddress('notas.txt')).toBe(false);
    expect(looksLikeWebAddress('C:file.txt')).toBe(false);
    expect(looksLikeWebAddress('dos palabras.com')).toBe(false);
  });
});

describe('shellFolderAlias', () => {
  it('resolves the names Windows opens by a bare name', () => {
    expect(shellFolderAlias('temp')).toBe(os.tmpdir());
    expect(shellFolderAlias('System32')?.toLowerCase()).toContain('system32');
  });

  it('answers nothing for a name it does not know', () => {
    expect(shellFolderAlias('no-es-una-carpeta')).toBeNull();
  });
});

describe('describeResolvedFile', () => {
  it('runs a batch file through cmd, naming the interpreter in the approved argv', () => {
    const plan = describeResolvedFile('C:\\scripts\\limpiar.bat', ['--dry']);
    expect(plan.kind).toBe('script');
    expect(plan.argv[0]).toBe('cmd.exe');
    expect(plan.argv.at(-1)).toContain('limpiar.bat');
  });

  it('hands a console file to the shell and an executable to CreateProcess', () => {
    expect(describeResolvedFile('C:\\Windows\\System32\\services.msc', []).kind).toBe('shell');
    expect(describeResolvedFile('C:\\app\\tool.exe', ['-v'])).toEqual({
      kind: 'program',
      target: 'C:\\app\\tool.exe',
      argv: ['C:\\app\\tool.exe', '-v'],
    });
  });
});

describe('the elevation script', () => {
  it('quotes an argument with a space so Start-Process keeps it as one', () => {
    expect(startProcessArg('C:\\mis notas.txt')).toBe('"C:\\mis notas.txt"');
    expect(startProcessArg('--flag')).toBe('--flag');
  });

  it('never lets an apostrophe in a path become a second PowerShell argument', () => {
    const script = buildElevationScript("C:\\Users\\O'Brien\\app.exe", []);
    expect(script).toContain("'C:\\Users\\O''Brien\\app.exe'");
    expect(script).toContain('Start-Process -FilePath');
    expect(script).toContain('-Verb RunAs');
  });
});

describe('scriptArgv', () => {
  it('quotes the whole cmd line once and doubles the quotes inside it', () => {
    expect(scriptArgv('C:\\a b\\x.bat', ['-q'])).toEqual(['cmd.exe', '/d', '/s', '/c', '""C:\\a b\\x.bat" "-q""']);
  });
});
