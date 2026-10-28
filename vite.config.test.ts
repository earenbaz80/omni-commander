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
