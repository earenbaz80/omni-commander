import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useModalDialog } from './useModalDialog';

function Harness({ label }: { label: string }) {
  const dialogRef = useModalDialog<HTMLDivElement>(label);
  return (
    <div ref={dialogRef} tabIndex={-1}>
      <button type="button">primero</button>
      <button type="button">segundo</button>
    </div>
  );
}

describe('useModalDialog', () => {
  it('turns the attached element into a labelled modal dialog', () => {
    render(<Harness label="Copiar archivos" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Copiar archivos');
  });

  it('moves focus into the dialog on mount', () => {
    render(<Harness label="Copiar archivos" />);
    expect(document.activeElement).toBe(screen.getByText('primero'));
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Harness label="Copiar archivos" />);
    const first = screen.getByText('primero');
    const second = screen.getByText('segundo');
    second.focus();
    fireEvent.keyDown(second, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<Harness label="Copiar archivos" />);
    const first = screen.getByText('primero');
    const second = screen.getByText('segundo');
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<Harness label="Copiar archivos" />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps working when the label changes', () => {
    const { rerender } = render(<Harness label="Antes" />);
    rerender(<Harness label="Después" />);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Después');
  });
});
