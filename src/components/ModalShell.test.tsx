import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalShell } from './ModalShell';

function TwoButtons() {
  return (
    <ModalShell label="Ajustes">
      <button type="button">primero</button>
      <button type="button">segundo</button>
    </ModalShell>
  );
}

describe('ModalShell', () => {
  it('exposes an accessible dialog with the given label', () => {
    render(
      <ModalShell label="Ajustes">
        <p>contenido</p>
      </ModalShell>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Ajustes');
    expect(screen.getByText('contenido')).toBeTruthy();
  });

  it('moves focus into the dialog on mount', () => {
    render(<TwoButtons />);
    expect(document.activeElement).toBe(screen.getByText('primero'));
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<TwoButtons />);
    const first = screen.getByText('primero');
    const second = screen.getByText('segundo');
    second.focus();
    fireEvent.keyDown(second, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<TwoButtons />);
    const first = screen.getByText('primero');
    const second = screen.getByText('segundo');
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it('lets Tab move forward normally between controls', () => {
    render(<TwoButtons />);
    const second = screen.getByText('segundo');
    screen.getByText('primero').focus();
    fireEvent.keyDown(screen.getByText('primero'), { key: 'Tab' });
    expect(document.activeElement).toBe(second);
  });

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<TwoButtons />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
