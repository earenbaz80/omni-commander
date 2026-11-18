// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * A check can arrive after the download finished — the periodic one, the one
 * fired eight seconds after launch, or the one behind the settings button. The
 * installer is already in `pending/` at that point, so an offer of the same
 * version must not take the restart away and ask for the file again.
 */
const require = createRequire(import.meta.url);
const { nextStateForEvent, nextStateForOffer } = require('./updateOffer.cjs') as {
  nextStateForOffer: (state: Record<string, unknown>, info?: { version?: unknown } | null) => Record<string, unknown>;
  nextStateForEvent: (state: Record<string, unknown>, event: string, payload?: unknown) => Record<string, unknown>;
};

const DOWNLOADED = {
  status: 'downloaded',
  version: '1.0.42',
  percent: 100,
  error: null,
  enabled: true,
  channel: 'stable',
};

const AVAILABLE = {
  status: 'available',
  version: '1.0.42',
  percent: 0,
  error: null,
  enabled: true,
  channel: 'stable',
};

describe('oferta de actualización', () => {
  it('no deshace una descarga que ya está hecha', () => {
    const next = nextStateForOffer(DOWNLOADED, { version: '1.0.42' });
    expect(next.status).toBe('downloaded');
    expect(next.version).toBe('1.0.42');
    expect(next.percent).toBe(100);
  });

  it('conserva lo que el resto de la app ya sabía', () => {
    const next = nextStateForOffer(DOWNLOADED, { version: '1.0.42' });
    expect(next.enabled).toBe(true);
    expect(next.channel).toBe('stable');
  });

  it('una versión más nueva vuelve a pedir la descarga', () => {
    const next = nextStateForOffer(DOWNLOADED, { version: '1.0.43' });
    expect(next.status).toBe('available');
    expect(next.version).toBe('1.0.43');
    expect(next.percent).toBe(0);
  });

  it('sin nada descargado la oferta es una descarga', () => {
    const next = nextStateForOffer({ status: 'checking', version: null, percent: 0 }, { version: '1.0.42' });
    expect(next.status).toBe('available');
    expect(next.version).toBe('1.0.42');
  });

  it('no conserva la descarga si la oferta no dice qué versión trae', () => {
    const next = nextStateForOffer(DOWNLOADED, undefined);
    expect(next.status).toBe('available');
    expect(next.version).toBe(null);
  });

  it('limpia el error de un intento anterior al ofrecer algo', () => {
    const failed = { ...DOWNLOADED, status: 'available', error: 'net::ERR_INTERNET_DISCONNECTED' };
    expect(nextStateForOffer(failed, { version: '1.0.42' }).error).toBe(null);
  });
});

/**
 * The events main.cjs forwards, in the order the updater emits them. A check
 * announces itself before it answers, so the answer is never the first thing
 * the state sees.
 */
function replay(start: Record<string, unknown>, events: Array<[string, unknown?]>) {
  return events.reduce((state, [event, payload]) => nextStateForEvent(state, event, payload), start);
}

describe('cableado del updater', () => {
  it('comprobar no borra la descarga terminada', () => {
    const next = replay(DOWNLOADED, [['checking-for-update']]);
    expect(next.status).toBe('downloaded');
    expect(next.percent).toBe(100);
    expect(next.version).toBe('1.0.42');
  });

  it('ni la borra la oferta de la misma versión que llega después', () => {
    const next = replay(DOWNLOADED, [['checking-for-update'], ['update-available', { version: '1.0.42' }]]);
    expect(next.status).toBe('downloaded');
    expect(next.percent).toBe(100);
  });

  it('ni la borra una comprobación que contesta que no hay nada', () => {
    const next = replay(DOWNLOADED, [['checking-for-update'], ['update-not-available']]);
    expect(next.status).toBe('downloaded');
  });

  it('una versión más nueva sí reemplaza la descarga que esperaba', () => {
    const next = replay(DOWNLOADED, [['checking-for-update'], ['update-available', { version: '1.0.43' }]]);
    expect(next.status).toBe('available');
    expect(next.version).toBe('1.0.43');
  });

  it('sin descarga pendiente, comprobar se ve como antes', () => {
    const next = replay(AVAILABLE, [['checking-for-update']]);
    expect(next.status).toBe('checking');
    expect(next.version).toBe('1.0.42');
  });

  it('y una respuesta sin nada deja la copia al día', () => {
    const next = replay(AVAILABLE, [['checking-for-update'], ['update-not-available']]);
    expect(next.status).toBe('up-to-date');
    expect(next.version).toBe(null);
  });

  it('la descarga entera termina en el reinicio aunque la comprobación se cruce', () => {
    const next = replay(AVAILABLE, [
      ['download-progress', { percent: 55 }],
      ['checking-for-update'],
      ['update-available', { version: '1.0.42' }],
      ['download-progress', { percent: 100 }],
      ['update-downloaded', { version: '1.0.42' }],
    ]);
    expect(next.status).toBe('downloaded');
    expect(next.percent).toBe(100);
  });
});
