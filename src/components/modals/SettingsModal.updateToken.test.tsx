import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import type { UserSettings } from '../../types';

/**
 * The token is the only credential this app sends anywhere, and it is entered in
 * a modal full of other text fields. What matters is that it goes to the main
 * process untouched, that an accepted one is cleared from the box, and that a
 * rejected one is not reported as saved.
 */
const settings: UserSettings = {
  theme: 'classic_blue',
  language: 'es',
  showHiddenFiles: true,
  showSystemFiles: true,
  showToolbar: true,
  confirmDelete: true,
  confirmCopyOverwrite: true,
  retroDosBorders: true,
  soundEffects: false,
  fontSize: 'normal',
  fontFamily: 'mono',
  splitLayout: 'horizontal',
  dualPaneRatio: 50,
  quickPreviewAutoPlay: true,
  showCommandLine: true,
  showFunctionBar: true,
  showDriveButtons: true,
  showHoverTooltips: true,
  showImageHoverThumbnails: true,
  showCollapsibleInfoDrawer: true,
  showClock: true,
  clockPosition: 'header',
  crtEffectEnabled: true,
  crtIntensity: 'subtle',
  blinkingCursorEnabled: true,
  cursorBlinkColor: 'cyan',
  fileSelectorColor: 'blue',
  authorName: 'tester',
  appLockEnabled: false,
  appUsername: 'admin',
  appPasswordHash: '',
  appPasswordSalt: '',
  protectedFolders: {},
  customShortcuts: {},
  useRecycleBin: true,
};

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwx';

function installBridge(overrides: { accepted?: boolean; state?: Record<string, unknown> } = {}) {
  const accepted = overrides.accepted ?? true;
  const bridge = {
    getUpdateState: vi.fn(
      async () => overrides.state ?? { status: 'error', enabled: true, tokenPath: 'C:\\datos\\update-token' },
    ),
    onUpdateState: () => () => {},
    setUpdateToken: vi.fn(async () => ({
      status: 'idle',
      enabled: true,
      accepted,
      tokenConfigured: accepted,
      tokenSource: accepted ? 'file' : null,
      tokenPath: 'C:\\datos\\update-token',
    })),
    clearUpdateToken: vi.fn(async () => ({
      status: 'idle',
      enabled: true,
      tokenConfigured: false,
      tokenSource: null,
      tokenPath: 'C:\\datos\\update-token',
    })),
    // The reply echoes the date, like the main process does: the reminder is
    // drawn from the snapshot, not from what was typed.
    setUpdateTokenExpiry: vi.fn(async (date: string | null) => ({
      status: 'idle',
      enabled: true,
      accepted: true,
      tokenConfigured: true,
      tokenSource: 'file',
      tokenPath: 'C:\\datos\\update-token',
      tokenExpiresAt: date,
    })),
    openExternal: vi.fn(async () => true),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = bridge;
  return bridge;
}

/** A real date `days` away, in the form the date input produces. */
function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The same date as the settings write it in Spanish. */
function spanishDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(year, month - 1, day),
  );
}

function openSecurityTab() {
  render(
    <SettingsModal
      theme={themes.classic_blue}
      lang="es"
      settings={settings}
      onUpdateSettings={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: translations.es.settingsTabSecurity }));
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('token de actualizaciones en Ajustes', () => {
  it('envía el valor tal cual y lo borra del formulario al aceptarlo', async () => {
    const bridge = installBridge({ accepted: true });
    openSecurityTab();

    // The section appears once the main process reports that an updater exists.
    fireEvent.change(await screen.findByLabelText(translations.es.updateTokenLabel), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: translations.es.updateTokenSave }));

    await waitFor(() => expect(bridge.setUpdateToken).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByText(translations.es.updateTokenSaved)).toBeTruthy();
    expect((screen.getByLabelText(translations.es.updateTokenLabel) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(translations.es.updateTokenConfigured)).toBeTruthy();
  });

  it('con un valor rechazado no dice que se guardó y deja corregirlo', async () => {
    const bridge = installBridge({ accepted: false });
    openSecurityTab();

    const input = (await screen.findByLabelText(translations.es.updateTokenLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'change-me' } });
    fireEvent.click(screen.getByRole('button', { name: translations.es.updateTokenSave }));

    await waitFor(() => expect(bridge.setUpdateToken).toHaveBeenCalledWith('change-me'));
    expect(await screen.findByText(translations.es.updateTokenInvalid)).toBeTruthy();
    // The value stays so it can be fixed instead of typed again.
    expect(input.value).toBe('change-me');
    expect(screen.getByText(translations.es.updateTokenMissing)).toBeTruthy();
  });

  it('ofrece quitar un token guardado en un archivo', async () => {
    const bridge = installBridge({ accepted: true });
    openSecurityTab();

    fireEvent.change(await screen.findByLabelText(translations.es.updateTokenLabel), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: translations.es.updateTokenSave }));
    await screen.findByText(translations.es.updateTokenConfigured);

    fireEvent.click(screen.getByRole('button', { name: translations.es.updateTokenClear }));
    await waitFor(() => expect(bridge.clearUpdateToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(translations.es.updateTokenCleared)).toBeTruthy();
    expect(screen.getByText(translations.es.updateTokenMissing)).toBeTruthy();
  });

  it('enlaza a la página del token y la abre por el proceso principal', async () => {
    // The window cannot navigate out of its document, so the link must leave
    // through the shell instead of pretending to be a normal anchor.
    const bridge = installBridge();
    openSecurityTab();

    const link = await screen.findByRole('link', { name: translations.es.updateTokenCreateLink });
    expect(link.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(screen.getByText(/Contents: Read-only/)).toBeTruthy();

    fireEvent.click(link);
    await waitFor(() =>
      expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/settings/personal-access-tokens/new'),
    );
  });

  it('avisa con la fecha de caducidad y deja renovarlo desde el aviso', async () => {
    const expiry = isoDaysFromNow(60);
    const bridge = installBridge({
      state: {
        status: 'up-to-date',
        enabled: true,
        tokenConfigured: true,
        tokenSource: 'file',
        tokenPath: 'C:\\datos\\update-token',
        tokenExpiresAt: expiry,
      },
    });
    openSecurityTab();

    const expected = translations.es.updateTokenExpires.replace('{date}', spanishDate(expiry));
    expect(await screen.findByText(expected)).toBeTruthy();

    // Renewing is a trip to the token list, the one page the shell opens for it.
    const renew = screen.getByRole('link', { name: translations.es.updateTokenRenewLink });
    expect(renew.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens');
    fireEvent.click(renew);
    await waitFor(() =>
      expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/settings/personal-access-tokens'),
    );
  });

  it('avisa en ámbar cuando la fecha está cerca y en rojo cuando ya pasó', async () => {
    const soon = isoDaysFromNow(3);
    installBridge({
      state: { enabled: true, tokenConfigured: true, tokenSource: 'file', tokenExpiresAt: soon },
    });
    openSecurityTab();

    const soonText = translations.es.updateTokenExpiresSoon.replace('{date}', spanishDate(soon)).replace('{days}', '3');
    expect(await screen.findByText(soonText)).toBeTruthy();
  });

  it('el aviso empieza a un mes vista, no antes', async () => {
    // The note lives only in this tab, so a threshold shorter than the interval
    // between visits is a warning nobody reads. A month is the promise.
    const monthAhead = isoDaysFromNow(30);
    installBridge({
      state: { enabled: true, tokenConfigured: true, tokenSource: 'file', tokenExpiresAt: monthAhead },
    });
    openSecurityTab();

    const soonText = translations.es.updateTokenExpiresSoon
      .replace('{date}', spanishDate(monthAhead))
      .replace('{days}', '30');
    expect(await screen.findByText(soonText)).toBeTruthy();
  });

  it('un día más allá del mes vuelve al tono neutro', async () => {
    const beyond = isoDaysFromNow(31);
    installBridge({
      state: { enabled: true, tokenConfigured: true, tokenSource: 'file', tokenExpiresAt: beyond },
    });
    openSecurityTab();

    expect(
      await screen.findByText(translations.es.updateTokenExpires.replace('{date}', spanishDate(beyond))),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        translations.es.updateTokenExpiresSoon.replace('{date}', spanishDate(beyond)).replace('{days}', '31'),
      ),
    ).toBeNull();
  });

  it('con la fecha pasada dice que caducó en vez de avisar como si sirviera', async () => {
    const past = isoDaysFromNow(-4);
    installBridge({
      state: { enabled: true, tokenConfigured: true, tokenSource: 'file', tokenExpiresAt: past },
    });
    openSecurityTab();

    const expiredText = translations.es.updateTokenExpired.replace('{date}', spanishDate(past));
    expect(await screen.findByText(expiredText)).toBeTruthy();
    expect(screen.queryByText(translations.es.updateTokenExpiresSoon.replace('{date}', spanishDate(past)))).toBeNull();
  });

  it('guarda la fecha elegida y envía null al borrarla', async () => {
    const bridge = installBridge({
      state: { enabled: true, tokenConfigured: true, tokenSource: 'file' },
    });
    openSecurityTab();

    // Without a date the card only suggests recording one.
    expect(await screen.findByText(translations.es.updateTokenExpiryHint)).toBeTruthy();

    const input = screen.getByLabelText(translations.es.updateTokenExpiryLabel) as HTMLInputElement;
    const chosen = isoDaysFromNow(90);
    fireEvent.change(input, { target: { value: chosen } });
    await waitFor(() => expect(bridge.setUpdateTokenExpiry).toHaveBeenCalledWith(chosen));
    expect(
      await screen.findByText(translations.es.updateTokenExpires.replace('{date}', spanishDate(chosen))),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(bridge.setUpdateTokenExpiry).toHaveBeenLastCalledWith(null));
    expect(await screen.findByText(translations.es.updateTokenExpiryHint)).toBeTruthy();
  });

  it('con el token en el entorno no ofrece quitarlo desde aquí', async () => {
    installBridge();
    const bridge = (window as unknown as { electronAPI: { getUpdateState: ReturnType<typeof vi.fn> } }).electronAPI;
    bridge.getUpdateState.mockResolvedValue({
      status: 'idle',
      enabled: true,
      tokenConfigured: true,
      tokenSource: 'env',
    });
    openSecurityTab();

    expect(await screen.findByText(translations.es.updateTokenFromEnv)).toBeTruthy();
    expect(screen.queryByRole('button', { name: translations.es.updateTokenClear })).toBeNull();
  });
});
