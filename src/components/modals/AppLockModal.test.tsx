import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { AppLockModal } from './AppLockModal';
import { themes } from '../../services/themeManager';
import { createPasswordRecord } from '../../services/appLock';

// jsdom does not implement SubtleCrypto; use Node's WebCrypto so the real
// PBKDF2 verification path is exercised.
beforeAll(() => {
  if (!globalThis.crypto || !(globalThis.crypto as Crypto).subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const renderLock = (props: Partial<React.ComponentProps<typeof AppLockModal>> = {}) =>
  render(
    <AppLockModal
      theme={themes.classic_blue}
      lang="en"
      expectedUser="admin"
      expectedPassHash="admin123"
      onUnlockSuccess={vi.fn()}
      {...props}
    />
  );

describe('AppLockModal', () => {
  it('never renders the stored password in the UI', () => {
    const { container } = renderLock({ expectedPassHash: 'TopSecret123' });
    expect(container.textContent).not.toContain('TopSecret123');
  });

  it('unlocks only with the correct credentials', async () => {
    const record = await createPasswordRecord('pw123');
    const onUnlockSuccess = vi.fn();
    const { container } = renderLock({
      expectedPassHash: record.hash,
      expectedPassSalt: record.salt,
      onUnlockSuccess,
    });

    const form = container.querySelector('form')!;
    const passInput = screen.getByPlaceholderText(/password/i);

    fireEvent.change(passInput, { target: { value: 'wrong' } });
    fireEvent.submit(form);
    await screen.findByText(/incorrect/i, undefined, { timeout: 5000 });
    expect(onUnlockSuccess).not.toHaveBeenCalled();

    fireEvent.change(passInput, { target: { value: 'pw123' } });
    fireEvent.submit(form);
    await waitFor(() => expect(onUnlockSuccess).toHaveBeenCalledTimes(1), { timeout: 5000 });
  }, 20000);
});
