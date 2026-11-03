import { ThemeConfig } from '../services/themeManager';
import ModalShell from './ModalShell';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock theme object for tests
const mockTheme: ThemeConfig = {
  id: 'classic_blue',
  nameKey: 'themeOmniClassic',
  bgApp: '#000084',
  bgPanel: '#0000a8',
  bgPanelInactive: '#000084',
  borderPanel: '#55ffff',
  borderFocus: '#ffffff',
  headerBg: '#1e90ff',
  headerText: '#000000',
  itemText: '#000000',
  dirText: '#0f4c81',
  exeText: '#ffe082',
  zipText: '#ffcdd2',
  docText: '#e1f5fe',
  mediaText: '#fce4ec',
  selectedText: '#ffffff',
  selectedBg: '#6090ff',
  cursorBg: '#7faaff',
  cursorText: '#000084',
  statusBg: '#0f264d',
  statusText: '#55ffff',
  fkeyNumBg: '#000000',
  fkeyNumText: '#ff9100',
  fkeyLabelBg: '#3e2400',
  fkeyLabelText: '#ffb000',
  promptBg: '#000000',
  promptText: '#ffb000',
  modalBg: '#f5f5f5',
  modalBorder: '#cccccc',
  modalHeaderBg: '#ffffff',
  modalHeaderText: '#000000',
  accent: '#3b82f6',
  accentWarn: '#a5f3fc',
  accentDanger: '#f87171',
  accentOk: '#a3e4d7',
  overlay: '#00000088',
  radius: '0',
  shadow: 'none',
  isRetro: false,
};

function TwoButtons() {
  return (
    <ModalShell label="Ajustes" theme={mockTheme}>
      <button type="button">primero</button>
      <button type="button">segundo</button>
    </ModalShell>
  );
}

describe('ModalShell', () => {
  it('exposes an accessible dialog with the given label', () => {
    render(
      <ModalShell label="Ajustes" theme={mockTheme}>
        <p>contenido</p>
      </ModalShell>,
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

  // A dialog taller than the window used to be clipped at both edges with no
  // way to reach its footer (the folder-sync table grew past the screen).
  it('caps the panel to the viewport and scrolls its body', () => {
    render(
      <ModalShell label="Sincronizar" theme={mockTheme}>
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('max-h-full');
    expect(panel.className).toContain('flex-col');

    const body = screen.getByText('contenido').parentElement as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
  });
});
