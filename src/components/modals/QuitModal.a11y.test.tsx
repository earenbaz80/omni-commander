import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuitModal } from './QuitModal';
import { themes } from '../../services/themeManager';

describe('QuitModal accessibility', () => {
  it('is a labelled modal dialog with trapped focus', () => {
    render(
      <QuitModal
        theme={themes.classic_blue}
        lang="es"
        onConfirmQuit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Salir');

    const buttons = Array.from(dialog.querySelectorAll('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });
});
