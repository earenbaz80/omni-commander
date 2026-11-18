// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * A check can arrive after the download finished — the periodic one, the one
 * fired eight seconds after launch, or the one behind the settings button — and
 * so can a failure. At that point the installer is in `pending/`, verified, and
 * none of those answers is about the file on disk: the restart has to survive
 * them all, and the reason a check failed is kept beside it.
 *
 * Every case below goes through the one function main.cjs calls, in the order
 * the updater emits the events.
 */
const require = createRequire(import.meta.url);
const { nextStateForEvent } = require('./updateOffer.cjs') as {
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

/** The events main.cjs forwards, in the order the updater emits them. */
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

  it('conserva lo que el resto de la app ya sabía', () => {
    const next = replay(DOWNLOADED, [['checking-for-update'], ['update-not-available']]);
    expect(next.enabled).toBe(true);
    expect(next.channel).toBe('stable');
  });

  it('una versión más nueva sí reemplaza la descarga que esperaba', () => {
    const next = replay(DOWNLOADED, [['checking-for-update'], ['update-available', { version: '1.0.43' }]]);
    expect(next.status).toBe('available');
    expect(next.version).toBe('1.0.43');
    expect(next.percent).toBe(0);
  });

  it('una oferta sin versión no puede conservar la descarga', () => {
    const next = replay(DOWNLOADED, [['checking-for-update'], ['update-available', undefined]]);
    expect(next.status).toBe('available');
    expect(next.version).toBe(null);
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

  it('el porcentaje de la descarga se queda entre 0 y 100', () => {
    expect(replay(AVAILABLE, [['download-progress', { percent: 137 }]]).percent).toBe(100);
    expect(replay(AVAILABLE, [['download-progress', { percent: -5 }]]).percent).toBe(0);
  });

  it('una comprobación que falla conserva el reinicio y deja escrito por qué', () => {
    const next = replay(DOWNLOADED, [
      ['checking-for-update'],
      ['error', { message: 'net::ERR_INTERNET_DISCONNECTED' }],
    ]);
    expect(next.status).toBe('downloaded');
    expect(next.percent).toBe(100);
    expect(next.version).toBe('1.0.42');
    expect(next.error).toBe('net::ERR_INTERNET_DISCONNECTED');
  });

  it('un fallo mientras se descarga sí se ve', () => {
    const next = replay(AVAILABLE, [
      ['download-progress', { percent: 40 }],
      ['error', { message: 'net::ERR_CONNECTION_RESET' }],
    ]);
    expect(next.status).toBe('error');
    expect(next.error).toBe('net::ERR_CONNECTION_RESET');
  });

  it('una comprobación que luego va bien limpia el error que había dejado', () => {
    const failed = replay(DOWNLOADED, [['error', { message: 'net::ERR_INTERNET_DISCONNECTED' }]]);
    const next = replay(failed, [['checking-for-update']]);
    expect(next.status).toBe('downloaded');
    expect(next.error).toBe(null);
  });
});
