import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { UnlockFolderModal } from './UnlockFolderModal';
import { themes } from '../../services/themeManager';
import { createPasswordRecord } from '../../services/appLock';
import { getTranslations } from '../../i18n/translations';

/**
 * A protected folder used to be opened by comparing what the user typed against
 * the password stored in settings, so the settings file held the password. This
 * modal is now the only place that sees a typed password, and it derives the
 * hash to compare instead of reading one.
 *
 * The other half of the change is what happens to protections saved by an older
 * build: they must still open, and the first successful unlock is the moment
 * their plaintext can be replaced by a derived record.
 */

// jsdom does not implement SubtleCrypto; use Node's WebCrypto so the real
// PBKDF2 path is exercised instead of a stub.
beforeAll(() => {
  if (!globalThis.crypto || !(globalThis.crypto as Crypto).subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const t = getTranslations('en');

const renderUnlock = (props: Partial<React.ComponentProps<typeof UnlockFolderModal>> = {}) =>
  render(
    <UnlockFolderModal
      theme={themes.classic_blue}
      lang="en"
      folderPath="C:\\documentos"
      record={{ salt: '', hash: 'sin-uso' }}
      onUpgrade={vi.fn()}
      onSuccess={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );

const typeAndSubmit = (container: HTMLElement, password: string) => {
  fireEvent.change(screen.getByPlaceholderText(t.unlockPassPlaceholder), { target: { value: password } });
  fireEvent.submit(container.querySelector('form')!);
};

describe('UnlockFolderModal', () => {
  it('abre la carpeta con la contraseña correcta de un registro derivado', async () => {
    const record = await createPasswordRecord('clave');
    const onSuccess = vi.fn();
    const onUpgrade = vi.fn();
    const { container } = renderUnlock({ record, onSuccess, onUpgrade });

    typeAndSubmit(container, 'clave');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 20000 });
    // Nothing to rewrite: this record was already a hash.
    expect(onUpgrade).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(record.hash);
  }, 30000);

  it('rechaza una contraseña equivocada sin abrir nada', async () => {
    const record = await createPasswordRecord('clave');
    const onSuccess = vi.fn();
    const { container } = renderUnlock({ record, onSuccess });

    typeAndSubmit(container, 'otra');

    await screen.findByText(t.unlockBadPass, undefined, { timeout: 20000 });
    expect(onSuccess).not.toHaveBeenCalled();
  }, 30000);

  it('abre una carpeta guardada en claro y la mejora a un registro derivado', async () => {
    const onSuccess = vi.fn();
    const onUpgrade = vi.fn();
    const { container } = renderUnlock({ record: { salt: '', hash: 'secreta' }, onSuccess, onUpgrade });

    typeAndSubmit(container, 'secreta');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 20000 });
    expect(onUpgrade).toHaveBeenCalledWith('secreta');
  }, 30000);

  it('no abre nada cuando no hay hash guardado', async () => {
    const onSuccess = vi.fn();
    const { container } = renderUnlock({ record: { salt: '', hash: '' }, onSuccess });

    typeAndSubmit(container, '');

    await screen.findByText(t.unlockBadPass, undefined, { timeout: 20000 });
    expect(onSuccess).not.toHaveBeenCalled();
  }, 30000);
});
