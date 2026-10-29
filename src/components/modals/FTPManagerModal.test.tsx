import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FTPManagerModal } from './FTPManagerModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';

/**
 * This modal used to fake a whole session and then offer a drive that does not
 * exist. The assertions below are the things that must never come back.
 */
const renderModal = () => render(<FTPManagerModal theme={themes.classic_blue} lang="en" onClose={vi.fn()} />);

describe('FTPManagerModal', () => {
  it('says plainly that the build has no client', () => {
    renderModal();

    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.getByText(translations.en.ftpNoClient)).toBeTruthy();
  });

  it('offers no way to claim a connection it never made', () => {
    renderModal();

    // The fabricated handshake, its success line and the "connected" badge.
    expect(screen.queryByText(/logged in/i)).toBeNull();
    expect(screen.queryByText(/handshake/i)).toBeNull();
    expect(screen.queryByText(/connected/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /drive/i })).toBeNull();
  });

  it('does not prefill credentials that read as a saved server', () => {
    renderModal();

    const host = screen.getByPlaceholderText(translations.en.ftpHostPlaceholder) as HTMLInputElement;
    expect(host.value).toBe('');
  });
});
