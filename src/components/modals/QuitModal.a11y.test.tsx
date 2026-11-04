import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuitModal } from './QuitModal';
import { themes } from '../../services/themeManager';
import { MODAL_FOCUSABLE_SELECTOR } from '../../hooks/useModalDialog';

describe('QuitModal accessibility', () => {
  it('is a labelled modal dialog with trapped focus', () => {
    render(<QuitModal theme={themes.classic_blue} lang="es" onConfirmQuit={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Cancelar');

    const buttons = Array.from(dialog.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(1);
    // The trap counts the title bar and the resize corner too, so the ends of the
    // ring are the ends of everything focusable, not of the buttons: taking the
    // list from the selector the hook walks is what the assertion is about.
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
    expect(stops.length).toBeGreaterThan(buttons.length);

    const first = stops[0];
    const last = stops[stops.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });
});
