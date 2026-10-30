import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

/**
 * The app is published from a private repository, so the public download URL
 * electron-updater defaults to answers 404 to every installed copy. A token
 * switches it to the authenticated API, and the resolver here decides what that
 * token is and what the feed looks like: a bad decision is the difference
 * between "no update is offered" and "the token was pasted somewhere public".
 */
const require = createRequire(import.meta.url);
const { normalizeToken, parseFeedConfig, readFeedConfig, readUpdateToken, resolveUpdateFeed } =
  require('./updateFeed.cjs') as {
    normalizeToken: (raw: unknown) => string | null;
    parseFeedConfig: (text: unknown) => { provider: 'github'; owner: string; repo: string } | null;
    readFeedConfig: (filePath: string, readFile: (file: string) => string) => unknown;
    readUpdateToken: (options?: {
      env?: Record<string, string | undefined>;
      tokenPath?: string;
      readFile?: (file: string) => string;
    }) => { token: string | null; source: 'env' | 'file' | null };
    resolveUpdateFeed: (options?: {
      appUpdateConfigPath?: string;
      env?: Record<string, string | undefined>;
      tokenPath?: string;
      readFile?: (file: string) => string;
    }) => {
      base: { provider: 'github'; owner: string; repo: string } | null;
      token: string | null;
      tokenSource: 'env' | 'file' | null;
      tokenPath: string | null;
      options: { provider: 'github'; owner: string; owner_repo?: string; repo?: string; token?: string } | null;
    };
  };

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwx';
const CONFIG_PATH = 'C:\\Program Files\\OmniCommander Pro\\resources\\app-update.yml';
const TOKEN_PATH = 'C:\\Users\\someone\\AppData\\Roaming\\OmniCommander Pro\\update-token';

/** The shape electron-builder actually writes for a GitHub target. */
const APP_UPDATE_YML = [
  'provider: github',
  'owner: earenbaz80',
  'repo: omni-commander',
  'updaterCacheDirName: omnicommander-pro-updater',
  '',
].join('\n');

describe('normalización del token', () => {
  it('acepta el token limpio', () => {
    expect(normalizeToken(TOKEN)).toBe(TOKEN);
  });

  it('tolera lo que añade un editor: espacios, saltos y comillas', () => {
    expect(normalizeToken(`  ${TOKEN}  \r\n`)).toBe(TOKEN);
    expect(normalizeToken(`"${TOKEN}"`)).toBe(TOKEN);
    expect(normalizeToken(`\n\n${TOKEN}\r\n`)).toBe(TOKEN);
  });

  it('se queda con la primera línea y no pega una nota al token', () => {
    expect(normalizeToken(`${TOKEN}\nnota: caduca en 90 días`)).toBe(TOKEN);
  });

  it('una nota encima del token lo deja sin leer, en vez de adivinar cuál es', () => {
    // The file is documented as "the token on its own". Guessing which line is
    // the credential would mean sending a sentence as an Authorization header on
    // a machine where the value was never really given.
    expect(normalizeToken(`nota suelta\n${TOKEN}`)).toBeNull();
  });

  it('rechaza un marcador, un valor corto y un token partido', () => {
    // A placeholder sent as an Authorization header produces a 401 that looks
    // like a permission problem instead of a missing credential.
    expect(normalizeToken('change-me')).toBeNull();
    expect(normalizeToken('ghp_corto')).toBeNull();
    expect(normalizeToken(`${TOKEN.slice(0, 24)} ${TOKEN.slice(24)}`)).toBeNull();
    expect(normalizeToken('')).toBeNull();
    expect(normalizeToken(null)).toBeNull();
    expect(normalizeToken(12)).toBeNull();
  });
});

describe('destino declarado en app-update.yml', () => {
  it('lee el proveedor y el repositorio del archivo que usa el updater', () => {
    expect(parseFeedConfig(APP_UPDATE_YML)).toEqual({
      provider: 'github',
      owner: 'earenbaz80',
      repo: 'omni-commander',
    });
  });

  it('acepta comillas, comentarios y CRLF de un archivo tocado a mano', () => {
    const text =
      '# generado por electron-builder\r\nprovider: "github"\r\nowner: \'earenbaz80\'\r\nrepo: omni-commander\r\n';
    expect(parseFeedConfig(text)).toEqual({ provider: 'github', owner: 'earenbaz80', repo: 'omni-commander' });
  });

  it('no inventa un destino cuando el archivo falta, está roto o es de otro proveedor', () => {
    const readFile = vi.fn(() => {
      throw new Error('ENOENT');
    });
    expect(readFeedConfig(CONFIG_PATH, readFile)).toBeNull();
    expect(parseFeedConfig('provider: generic\nurl: https://example.com\n')).toBeNull();
    expect(parseFeedConfig('provider: github\nowner: earenbaz80\n')).toBeNull();
    expect(parseFeedConfig('')).toBeNull();
    expect(parseFeedConfig(undefined)).toBeNull();
    // Sin ruta no hay nada que abrir, y no debe lanzarse una lectura a ciegas.
    expect(readFeedConfig('', readFile)).toBeNull();
  });
});

describe('lectura del token en el equipo', () => {
  it('el entorno gana sobre el archivo', () => {
    const readFile = vi.fn(() => 'otro-token-suficientemente-largo-para-pasar');
    expect(readUpdateToken({ env: { OMNI_UPDATE_TOKEN: TOKEN }, tokenPath: TOKEN_PATH, readFile })).toEqual({
      token: TOKEN,
      source: 'env',
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('sin entorno, lee el archivo indicado', () => {
    const readFile = vi.fn(() => `${TOKEN}\n`);
    expect(readUpdateToken({ env: {}, tokenPath: TOKEN_PATH, readFile })).toEqual({ token: TOKEN, source: 'file' });
    expect(readFile).toHaveBeenCalledWith(TOKEN_PATH);
  });

  it('un archivo ausente o ilegible es simplemente "sin token"', () => {
    const readFile = vi.fn(() => {
      throw new Error('ENOENT');
    });
    // A missing credential must not stop the app from starting.
    expect(readUpdateToken({ env: {}, tokenPath: TOKEN_PATH, readFile })).toEqual({ token: null, source: null });
    expect(readUpdateToken({ env: {} })).toEqual({ token: null, source: null });
    expect(readUpdateToken()).toEqual({ token: null, source: null });
  });

  it('un archivo con basura no se convierte en credencial', () => {
    expect(readUpdateToken({ env: {}, tokenPath: TOKEN_PATH, readFile: () => '   \n' })).toEqual({
      token: null,
      source: null,
    });
  });
});

describe('feed del updater', () => {
  it('con token, el feed lleva la credencial junto al destino del paquete', () => {
    const feed = resolveUpdateFeed({
      appUpdateConfigPath: CONFIG_PATH,
      env: { OMNI_UPDATE_TOKEN: TOKEN },
      tokenPath: TOKEN_PATH,
      readFile: () => APP_UPDATE_YML,
    });

    expect(feed.options).toEqual({
      provider: 'github',
      owner: 'earenbaz80',
      repo: 'omni-commander',
      token: TOKEN,
    });
    expect(feed.tokenSource).toBe('env');
    expect(feed.tokenPath).toBe(TOKEN_PATH);
  });

  it('sin token mantiene el proveedor público, que sirve para un repositorio abierto', () => {
    const feed = resolveUpdateFeed({
      appUpdateConfigPath: CONFIG_PATH,
      env: {},
      tokenPath: TOKEN_PATH,
      readFile: () => APP_UPDATE_YML,
    });

    expect(feed.options).toEqual({ provider: 'github', owner: 'earenbaz80', repo: 'omni-commander' });
    expect(feed.token).toBeNull();
    expect(feed.tokenPath).toBe(TOKEN_PATH);
  });

  it('sin app-update.yml no toca la configuración del paquete y aun así informa del token', () => {
    const feed = resolveUpdateFeed({
      appUpdateConfigPath: CONFIG_PATH,
      env: { OMNI_UPDATE_TOKEN: TOKEN },
      tokenPath: TOKEN_PATH,
      readFile: () => {
        throw new Error('ENOENT');
      },
    });

    expect(feed.options).toBeNull();
    expect(feed.token).toBe(TOKEN);
    expect(feed.base).toBeNull();
  });
});
