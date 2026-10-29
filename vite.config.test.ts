import { describe, expect, it } from 'vitest';
import configFactory from './vite.config';

/**
 * Loads the real Vite config with `DISABLE_HMR` set to the given value, then
 * puts the environment back so one case cannot leak into the next.
 */
const configWith = (disableHmr: string | undefined) => {
  const previous = process.env.DISABLE_HMR;
  if (disableHmr === undefined) delete process.env.DISABLE_HMR;
  else process.env.DISABLE_HMR = disableHmr;
  try {
    return configFactory({
      command: 'serve',
      mode: 'development',
      isSsrBuild: false,
      isPreview: false,
    });
  } finally {
    if (previous === undefined) delete process.env.DISABLE_HMR;
    else process.env.DISABLE_HMR = previous;
  }
};

/**
 * Runs the injected policy over a minimal document, the way Vite does when it
 * serves or builds index.html, so the test checks what the browser would read.
 */
const htmlWithPolicy = (command: 'serve' | 'build', mode: string) => {
  const config = configFactory({ command, mode, isSsrBuild: false, isPreview: false } as any);
  const plugin = (config.plugins as any[]).find((p) => p && p.name === 'omni-content-security-policy');
  expect(plugin).toBeDefined();
  return plugin.transformIndexHtml.handler('<html><head><title>Omni</title></head><body></body></html>') as string;
};

const policyOf = (html: string) => {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(html);
  expect(match).not.toBeNull();
  return match![1];
};

describe('política de contenido del documento', () => {
  // The app has to work with the cable out, so a remote load is a bug. The
  // browser is what enforces it; this checks the policy it will read.
  it('encierra el build en sus propios ficheros y el API local', () => {
    const policy = policyOf(htmlWithPolicy('build', 'production'));

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:* http://localhost:*");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    // No scheme or host that reaches outside the machine: loopback is the only
    // thing named with a port wildcard, which is the API's own.
    expect(policy).not.toContain('https:');
    expect(policy.match(/\*\//g)).toBeNull();
  });

  it('no relaja los scripts del build, que no necesitan código en línea', () => {
    const policy = policyOf(htmlWithPolicy('build', 'production'));

    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    // The websocket is the dev server's; a packaged build must not allow it.
    expect(policy).not.toContain('ws://');
  });

  it('deja al servidor de desarrollo su preámbulo en línea y su websocket', () => {
    const policy = policyOf(htmlWithPolicy('serve', 'development'));

    expect(policy).toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).toMatch(/connect-src[^;]*ws:\/\/localhost:\*/);
  });

  it('coloca la política antes de cualquier recurso, donde aún se aplica', () => {
    const html = htmlWithPolicy('build', 'production');

    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('Content-Security-Policy')).toBeGreaterThan(html.indexOf('<head>'));
  });
});

describe('servidor de desarrollo de Vite', () => {
  // Without a watcher the dev server never invalidates a transformed module,
  // so a browser reload keeps getting the code from before the server started:
  // a fixed component still looks broken until the process is restarted. Only
  // the live-reload channel is allowed to be switched off.
  it.each([undefined, '', 'false', 'true'])('vigila los ficheros con DISABLE_HMR=%s', (value) => {
    const config = configWith(value);
    expect(config.server?.watch).not.toBeNull();
    expect(config.server?.watch).not.toBeUndefined();
  });

  it('apaga solo la recarga en vivo cuando DISABLE_HMR vale true', () => {
    expect(configWith('true').server?.hmr).toBe(false);
  });

  it('mantiene la recarga en vivo en cualquier otro caso', () => {
    for (const value of [undefined, '', 'false']) {
      expect(configWith(value).server?.hmr).not.toBe(false);
    }
  });
});
