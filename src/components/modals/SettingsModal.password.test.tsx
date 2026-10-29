import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import { createPasswordRecord, verifyPassword } from '../../services/appLock';
import type { UserSettings } from '../../types';

const baseSettings: UserSettings = {
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

function renderModal(settings: UserSettings, onUpdateSettings = vi.fn()) {
  render(
    <SettingsModal
      theme={themes.classic_blue}
      lang="es"
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: translations.es.settingsTabSecurity }));
  return onUpdateSettings;
}

// The reveal buttons reuse the field label as their accessible name, so label
// queries are narrowed to the inputs themselves.
function passwordInput(label: string) {
  return screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;
}

function typePassword(password: string, confirmation = password) {
  fireEvent.change(passwordInput(translations.es.settingsAppPass), { target: { value: password } });
  fireEvent.change(passwordInput(translations.es.protectConfirm), { target: { value: confirmation } });
}

function currentPasswordInput() {
  return passwordInput(translations.es.settingsAppCurrentPass);
}

function typeCurrentPassword(password: string) {
  fireEvent.change(currentPasswordInput(), { target: { value: password } });
}

async function settingsWithPassword(password: string): Promise<UserSettings> {
  const record = await createPasswordRecord(password);
  return {
    ...baseSettings,
    appLockEnabled: true,
    appPasswordHash: record.hash,
    appPasswordSalt: record.salt,
  };
}

/**
 * Drives the import control the way a browser does: the component builds a
 * throwaway `<input type="file">` and clicks it, so the test intercepts that
 * element, gives it a stand-in file and fires `change` on it. jsdom has no file
 * picker, hence the click stub.
 */
async function importSettingsFile(raw: string) {
  const createElement = document.createElement.bind(document);
  let fileInput: HTMLInputElement | null = null;
  const create = vi.spyOn(document, 'createElement').mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    const element = createElement(tag, options);
    if (tag === 'input') fileInput = element as HTMLInputElement;
    return element;
  }) as typeof document.createElement);
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

  try {
    fireEvent.click(screen.getByRole('button', { name: translations.es.settingsImportConfig }));
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput!, 'files', {
      value: [{ text: async () => raw }],
      configurable: true,
    });

    await act(async () => {
      fireEvent.change(fileInput!);
      // The handler awaits `file.text()`; a macrotask turn drains those
      // microtasks before the assertions see the state.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  } finally {
    create.mockRestore();
    click.mockRestore();
  }
}

describe('SettingsModal app password', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hashes a first password with PBKDF2 and enables the lock', async () => {
    const onUpdate = renderModal(baseSettings);
    const lockToggle = screen.getByRole('checkbox') as HTMLInputElement;

    // Nothing to unlock with yet, and the form must still let the user create one.
    expect(lockToggle.disabled).toBe(true);

    typePassword('clave-segura-123');
    expect(lockToggle.disabled).toBe(false);
    fireEvent.click(lockToggle);

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const saved = onUpdate.mock.calls[0][0] as Partial<UserSettings>;

    expect(saved.appLockEnabled).toBe(true);
    expect(saved.appPasswordHash).toBeTruthy();
    expect(saved.appPasswordSalt).toBeTruthy();
    expect(saved.appPasswordHash).not.toBe('clave-segura-123');
    expect(saved).not.toHaveProperty('newPassword');
    expect(saved).not.toHaveProperty('confirmPassword');
    expect(JSON.stringify(saved)).not.toContain('clave-segura-123');

    await expect(
      verifyPassword('clave-segura-123', {
        hash: saved.appPasswordHash!,
        salt: saved.appPasswordSalt!,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyPassword('otra-clave', {
        hash: saved.appPasswordHash!,
        salt: saved.appPasswordSalt!,
      }),
    ).resolves.toBe(false);
    // Three PBKDF2 derivations at 100k iterations each, in real WebCrypto: on a
    // loaded machine those alone have been measured past the 5 s default, which
    // is a budget for the crypto, not a looser assertion.
  }, 30000);

  it('refuses to save when the confirmation does not match', async () => {
    const onUpdate = renderModal(baseSettings);
    typePassword('clave-segura-123', 'clave-distinta');

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(screen.getByText(translations.es.protectMismatch)).toBeTruthy());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps an existing hash untouched when no new password is typed', async () => {
    const existing = {
      ...baseSettings,
      appLockEnabled: true,
      appPasswordHash: 'hash-existente',
      appPasswordSalt: 'salt-existente',
    };
    const onUpdate = renderModal(existing);

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const saved = onUpdate.mock.calls[0][0] as Partial<UserSettings>;
    expect(saved.appPasswordHash).toBe('hash-existente');
    expect(saved.appPasswordSalt).toBe('salt-existente');
  });

  it('keeps the password masked when the field loses focus', () => {
    renderModal(baseSettings);
    const newPassword = passwordInput(translations.es.settingsAppPass);
    const confirm = passwordInput(translations.es.protectConfirm);

    fireEvent.change(newPassword, { target: { value: 'clave-secreta' } });
    fireEvent.blur(newPassword);
    expect(newPassword.getAttribute('type')).toBe('password');

    fireEvent.change(confirm, { target: { value: 'clave-secreta' } });
    fireEvent.blur(confirm);
    expect(confirm.getAttribute('type')).toBe('password');

    // Leaving an unrelated field must not reveal anything either.
    fireEvent.blur(screen.getByDisplayValue('admin'));
    expect(newPassword.getAttribute('type')).toBe('password');

    // The eye control is the only thing that shows the password, and it carries
    // its own label instead of repeating the field's.
    const reveal = within(newPassword.parentElement as HTMLElement).getByRole('button', {
      name: translations.es.settingsShowPassword,
    }) as HTMLButtonElement;
    fireEvent.click(reveal);
    expect(newPassword.getAttribute('type')).toBe('text');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    expect(reveal.getAttribute('aria-label')).toBe(translations.es.settingsHidePassword);

    fireEvent.click(reveal);
    expect(newPassword.getAttribute('type')).toBe('password');
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    expect(reveal.getAttribute('aria-label')).toBe(translations.es.settingsShowPassword);
  });

  it('only asks for the current password once one is stored', () => {
    renderModal(baseSettings);
    expect(screen.queryByText(translations.es.settingsAppCurrentPass)).toBeNull();
  });

  it('refuses to replace a stored password without the current one', async () => {
    const onUpdate = renderModal(await settingsWithPassword('vieja-clave'));
    typePassword('nueva-clave-123');

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(screen.getByText(translations.es.settingsAppCurrentPassRequired)).toBeTruthy());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('rejects a wrong current password and keeps the stored hash', async () => {
    const onUpdate = renderModal(await settingsWithPassword('vieja-clave'));
    typePassword('nueva-clave-123');
    typeCurrentPassword('clave-equivocada');

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(screen.getByText(translations.es.settingsAppCurrentPassWrong)).toBeTruthy());
    expect(onUpdate).not.toHaveBeenCalled();
    // The rejected attempt is wiped from the form.
    expect(currentPasswordInput().value).toBe('');
  });

  it('replaces the hash when the current password verifies', async () => {
    const existing = await settingsWithPassword('vieja-clave');
    const onUpdate = renderModal(existing);
    typePassword('nueva-clave-123');
    typeCurrentPassword('vieja-clave');

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const saved = onUpdate.mock.calls[0][0] as Partial<UserSettings>;

    expect(saved.appPasswordHash).not.toBe(existing.appPasswordHash);
    expect(saved.appPasswordSalt).not.toBe(existing.appPasswordSalt);
    expect(saved).not.toHaveProperty('currentPassword');
    expect(JSON.stringify(saved)).not.toContain('vieja-clave');
    expect(JSON.stringify(saved)).not.toContain('nueva-clave-123');

    const record = { hash: saved.appPasswordHash!, salt: saved.appPasswordSalt! };
    await expect(verifyPassword('nueva-clave-123', record)).resolves.toBe(true);
    await expect(verifyPassword('vieja-clave', record)).resolves.toBe(false);
  });

  it('still creates a first password without asking for a current one', async () => {
    const onUpdate = renderModal(baseSettings);
    typePassword('primera-clave');

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const saved = onUpdate.mock.calls[0][0] as Partial<UserSettings>;
    await expect(
      verifyPassword('primera-clave', {
        hash: saved.appPasswordHash!,
        salt: saved.appPasswordSalt!,
      }),
    ).resolves.toBe(true);
  });

  it('leaves typed passwords out of the exported settings', async () => {
    const hadCreateObjectURL = 'createObjectURL' in URL;
    let exported = '';
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: unknown[]) {
          exported = String(parts[0]);
        }
      },
    );

    try {
      renderModal(await settingsWithPassword('vieja-clave'));
      typePassword('nueva-clave-123');
      typeCurrentPassword('vieja-clave');

      fireEvent.click(screen.getByRole('button', { name: translations.es.settingsExportConfig }));

      // The file is a settings backup: it must still carry the real settings.
      expect(exported).toContain('"theme": "classic_blue"');
      // ...but neither the passwords typed in the form nor anything the lock
      // needs to work.
      expect(exported).not.toContain('nueva-clave-123');
      expect(exported).not.toContain('vieja-clave');
      expect(exported).not.toMatch(/currentPassword|newPassword|confirmPassword/);
      const payload = JSON.parse(exported) as Record<string, unknown>;
      expect(payload).not.toHaveProperty('appLockEnabled');
      expect(payload).not.toHaveProperty('appPasswordHash');
      expect(payload).not.toHaveProperty('appPasswordSalt');
      // The settings that are not lock-related still travel.
      expect(payload.language).toBe('es');
    } finally {
      vi.unstubAllGlobals();
      click.mockRestore();
      if (!hadCreateObjectURL) {
        Reflect.deleteProperty(URL, 'createObjectURL');
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    }
  });

  it('ignores the app lock keys of an imported settings file', async () => {
    const existing = await settingsWithPassword('clave-local');
    const onUpdate = renderModal(existing);

    // What a backup written by an older build on another machine looks like:
    // real settings plus the whole lock, including clear-text form fields.
    await importSettingsFile(
      JSON.stringify({
        theme: 'matrix_green',
        appUsername: 'usuario-importado',
        appLockEnabled: true,
        appPasswordHash: 'hash-de-otra-maquina',
        appPasswordSalt: 'salt-de-otra-maquina',
        currentPassword: 'vieja-clave',
        newPassword: 'clave-del-backup',
        confirmPassword: 'clave-del-backup',
      }),
    );

    // The merge did happen — otherwise the lock assertions below are vacuous.
    expect(screen.getByDisplayValue('usuario-importado')).toBeTruthy();
    // ...but the file's clear-text passwords were not loaded into the form.
    expect(passwordInput(translations.es.settingsAppPass).value).toBe('');
    expect(currentPasswordInput().value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const saved = onUpdate.mock.calls[0][0] as Partial<UserSettings>;

    expect(saved.theme).toBe('matrix_green');
    expect(saved.appUsername).toBe('usuario-importado');
    // This machine keeps its own lock and credential.
    expect(saved.appLockEnabled).toBe(true);
    expect(saved.appPasswordHash).toBe(existing.appPasswordHash);
    expect(saved.appPasswordSalt).toBe(existing.appPasswordSalt);
    expect(JSON.stringify(saved)).not.toContain('clave-del-backup');
  });

  it('reports an imported file that is not a settings object', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onUpdate = renderModal(baseSettings);

    await importSettingsFile('["matrix_green"]');

    expect(alertSpy).toHaveBeenCalledWith(translations.es.settingsInvalidConfig);
    // Nothing was merged, so no array index leaked into the form.
    expect(screen.getByDisplayValue('admin')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: translations.es.btnSave }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const saved = onUpdate.mock.calls[0][0] as Partial<UserSettings>;
    expect(saved.theme).toBe('classic_blue');
    expect(saved).not.toHaveProperty('0');
  });
});
