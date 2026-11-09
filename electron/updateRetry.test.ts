// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * A check that fails because GitHub is down is not the same as one that fails
 * because the feed is wrong, and the difference decides whether the app tries
 * again by itself. The strings below are the ones the 1.0.43 release actually
 * produced from this machine: the provider's `HttpError`, the raw response body
 * that came back instead of the manifest, and the downloader's `Response code`.
 */
const require = createRequire(import.meta.url);
const { isTransientUpdateError, nextRetryDelay, MAX_TRANSIENT_RETRIES, RETRY_BASE_DELAY_MS } =
  require('./updateRetry.cjs') as {
    isTransientUpdateError: (message: unknown) => boolean;
    nextRetryDelay: (attempt: unknown) => number | null;
    MAX_TRANSIENT_RETRIES: number;
    RETRY_BASE_DELAY_MS: number;
  };

const WRAPPED = 'Cannot parse releases feed: Error: Unable to find latest version on GitHub, HttpError: 504';
const BODY =
  '504 \n"method: GET url: https://github.com/earenbaz80/omni-commander/releases/download/v1.0.43/latest.yml\n\n Data:\n <html><body><h1>504 Gateway Time-out</h1></body></html>"';

describe('reintento de la comprobación', () => {
  it('reconoce el 504 que envuelve el proveedor', () => {
    expect(isTransientUpdateError(WRAPPED)).toBe(true);
  });

  it('reconoce el 504 que llega como cuerpo de la respuesta', () => {
    expect(isTransientUpdateError(BODY)).toBe(true);
  });

  it('reconoce el código que imprime el descargador', () => {
    expect(isTransientUpdateError('Response code 502 (Bad Gateway)')).toBe(true);
  });

  it('reconoce los otros 5xx y las frases del servidor', () => {
    expect(isTransientUpdateError('HttpError: 503')).toBe(true);
    expect(isTransientUpdateError('HTTP 500')).toBe(true);
    expect(isTransientUpdateError('Service Unavailable')).toBe(true);
  });

  it('no repite un 404: el feed esta mal y repetirlo no lo arregla', () => {
    expect(isTransientUpdateError('Unable to find latest version on GitHub: HttpError: 404')).toBe(false);
    expect(isTransientUpdateError('ERR_UPDATER_LATEST_VERSION_NOT_FOUND')).toBe(false);
  });

  it('no repite un fallo de red local', () => {
    expect(isTransientUpdateError('net::ERR_INTERNET_DISCONNECTED')).toBe(false);
    expect(isTransientUpdateError('')).toBe(false);
    expect(isTransientUpdateError(undefined)).toBe(false);
  });

  it('espera cada vez mas y se detiene al agotar los intentos', () => {
    expect(nextRetryDelay(0)).toBe(RETRY_BASE_DELAY_MS);
    expect(nextRetryDelay(1)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(nextRetryDelay(2)).toBe(RETRY_BASE_DELAY_MS * 4);
    expect(nextRetryDelay(MAX_TRANSIENT_RETRIES)).toBe(null);
    expect(nextRetryDelay(99)).toBe(null);
  });

  it('un contador invalido empieza por el primer plazo', () => {
    expect(nextRetryDelay(undefined)).toBe(RETRY_BASE_DELAY_MS);
    expect(nextRetryDelay(-2)).toBe(RETRY_BASE_DELAY_MS);
  });
});
