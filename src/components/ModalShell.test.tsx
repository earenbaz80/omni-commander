import { ThemeConfig } from '../services/themeManager';
import ModalShell from './ModalShell';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

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

  // The title bar and the corner are tab stops of their own now, which is what
  // makes a window movable from the keyboard; the trap has to wrap around the
  // whole set, so these check its two ends instead of two buttons.
  it('wraps Tab from the corner back to the title bar', () => {
    render(<TwoButtons />);
    const titleBar = screen.getByRole('group', { name: 'Mover ventana' });
    const corner = screen.getByLabelText('Redimensionar ventana');
    corner.focus();
    fireEvent.keyDown(corner, { key: 'Tab' });
    expect(document.activeElement).toBe(titleBar);
  });

  it('wraps Shift+Tab from the title bar back to the corner', () => {
    render(<TwoButtons />);
    const titleBar = screen.getByRole('group', { name: 'Mover ventana' });
    const corner = screen.getByLabelText('Redimensionar ventana');
    titleBar.focus();
    fireEvent.keyDown(titleBar, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(corner);
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

  // Dialogs that work like a window of their own get the three title-bar
  // buttons; the rest would only gain two controls that do nothing useful.
  it('rolls the window up to its title bar', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme} windowControls minimizeLabel="Minimizar">
        <p>contenido</p>
      </ModalShell>,
    );
    const body = screen.getByText('contenido').parentElement as HTMLElement;
    fireEvent.click(screen.getByLabelText('Minimizar'));
    expect(body.hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByLabelText('Minimizar'));
    expect(body.hasAttribute('hidden')).toBe(false);
  });

  it('fills the viewport when maximised and tells the content', () => {
    const onFillChange = vi.fn();
    render(
      <ModalShell
        label="Mapas"
        theme={mockTheme}
        windowControls
        maximizeLabel="Maximizar"
        restoreLabel="Restaurar"
        onFillChange={onFillChange}
      >
        <p>contenido</p>
      </ModalShell>,
    );
    fireEvent.click(screen.getByLabelText('Maximizar'));
    expect(screen.getByRole('dialog').className).toContain('max-w-none');
    expect(onFillChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByLabelText('Restaurar'));
    expect(screen.getByRole('dialog').className).toContain('max-w-3xl');
    expect(onFillChange).toHaveBeenLastCalledWith(false);
  });

  // A dialog that behaves like a window has to be sized like one; before this
  // the map window could only be maximised, and its map never grew.
  it('sizes the panel when its corner is dragged', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme} windowControls resizable resizeLabel="Redimensionar ventana">
        <p>contenido</p>
      </ModalShell>,
    );
    const handle = screen.getByLabelText('Redimensionar ventana');

    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent(handle, down);

    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientX: 700, clientY: 400 });
    fireEvent(handle, move);

    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel.style.width).toBe('600px');
    expect(panel.style.height).toBe('300px');
    // Wider than the width the dialog was designed for, so the cap has to go.
    expect(panel.className).toContain('max-w-none');
  });

  // The overlay centres the panel, so a drag used to grow it in both
  // directions and the corner slid away from the pointer at half speed. The
  // panel is anchored where the drag started instead.
  it('keeps the dragged corner under the pointer', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme} resizable resizeLabel="Redimensionar ventana">
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    panel.getBoundingClientRect = () =>
      ({ left: 200, top: 100, width: 400, height: 300, right: 600, bottom: 400, x: 200, y: 100 }) as DOMRect;

    const handle = screen.getByLabelText('Redimensionar ventana');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { pointerId: 1, clientX: 600, clientY: 400 });
    fireEvent(handle, down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientX: 660, clientY: 430 });
    fireEvent(handle, move);

    // The corner moved 60 by 30, so the panel grew by exactly that and its
    // top-left stayed where it was.
    expect(panel.style.width).toBe('460px');
    expect(panel.style.height).toBe('330px');
    expect(panel.style.position).toBe('absolute');
    expect(panel.style.left).toBe('200px');
    expect(panel.style.top).toBe('100px');
  });

  it('lets any dialog be dragged out to a size, not just the map', () => {
    render(
      <ModalShell label="Borrar" theme={mockTheme}>
        <p>contenido</p>
      </ModalShell>,
    );
    expect(screen.getByLabelText('Redimensionar ventana')).toBeTruthy();
  });

  // The other half of behaving like a window: the title bar carries it.
  it('moves the panel when its title bar is dragged', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme}>
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    panel.getBoundingClientRect = () =>
      ({ left: 200, top: 100, width: 400, height: 300, right: 600, bottom: 400, x: 200, y: 100 }) as DOMRect;

    const title = screen.getByText('Mapas');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { pointerId: 1, clientX: 300, clientY: 120 });
    fireEvent(title, down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientX: 360, clientY: 160 });
    fireEvent(title, move);

    expect(panel.style.left).toBe('260px');
    expect(panel.style.top).toBe('140px');
    // Carrying a window does not resize it.
    expect(panel.style.width).toBe('400px');
    expect(panel.style.height).toBe('300px');
  });

  it('leaves a press on a title-bar control to that control', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme} onClose={() => {}} closeButtonLabel="Cerrar ventana">
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    const close = screen.getByLabelText('Cerrar ventana');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { pointerId: 1, clientX: 300, clientY: 120 });
    fireEvent(close, down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientX: 380, clientY: 170 });
    fireEvent(close, move);

    expect(panel.style.left).toBe('');
    expect(panel.style.top).toBe('');
  });

  it('never drags the panel below a usable size', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme} resizable resizeLabel="Redimensionar ventana">
        <p>contenido</p>
      </ModalShell>,
    );
    const handle = screen.getByLabelText('Redimensionar ventana');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { pointerId: 1, clientX: 800, clientY: 600 });
    fireEvent(handle, down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent(handle, move);

    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel.style.width).toBe('320px');
    expect(panel.style.height).toBe('220px');
  });

  it('drops the corner while the panel is maximised', () => {
    render(
      <ModalShell
        label="Mapas"
        theme={mockTheme}
        windowControls
        maximizeLabel="Maximizar"
        resizable
        resizeLabel="Redimensionar ventana"
      >
        <p>contenido</p>
      </ModalShell>,
    );
    fireEvent.click(screen.getByLabelText('Maximizar'));
    expect(screen.queryByLabelText('Redimensionar ventana')).toBeNull();
  });

  // Moving a window was pointer-only, which left the layout out of reach of a
  // keyboard. The bar carries the panel with the arrows; Shift sizes it.
  it('moves the panel with the arrow keys on its title bar', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme}>
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    panel.getBoundingClientRect = () =>
      ({ left: 200, top: 100, width: 400, height: 300, right: 600, bottom: 400, x: 200, y: 100 }) as DOMRect;

    const titleBar = screen.getByRole('group', { name: 'Mover ventana' });
    fireEvent.keyDown(titleBar, { key: 'ArrowRight' });
    expect(panel.style.left).toBe('216px');
    expect(panel.style.top).toBe('100px');
    // Carrying a window does not resize it.
    expect(panel.style.width).toBe('400px');
    expect(panel.style.height).toBe('300px');
  });

  it('sizes the panel with Shift and the arrows on its title bar', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme}>
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    panel.getBoundingClientRect = () =>
      ({ left: 200, top: 100, width: 400, height: 300, right: 600, bottom: 400, x: 200, y: 100 }) as DOMRect;

    fireEvent.keyDown(screen.getByRole('group', { name: 'Mover ventana' }), { key: 'ArrowDown', shiftKey: true });
    expect(panel.style.height).toBe('316px');
    // Growing towards the corner leaves the top-left where it was.
    expect(panel.style.top).toBe('100px');
    expect(panel.style.left).toBe('200px');
  });

  // The corner does the same job with the arrows and is the only place the size
  // can be read back, since nothing on screen prints it.
  it('sizes the panel with the arrow keys on its corner and reads the result out', () => {
    render(
      <ModalShell label="Mapas" theme={mockTheme} resizable resizeLabel="Redimensionar ventana">
        <p>contenido</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    panel.getBoundingClientRect = () =>
      ({ left: 200, top: 100, width: 400, height: 300, right: 600, bottom: 400, x: 200, y: 100 }) as DOMRect;

    const corner = screen.getByLabelText('Redimensionar ventana');
    corner.focus();
    expect(corner.getAttribute('tabindex')).toBe('0');
    expect(corner.getAttribute('aria-orientation')).toBe('horizontal');
    expect(corner.getAttribute('aria-valuemin')).toBe('320');

    fireEvent.keyDown(corner, { key: 'ArrowRight' });
    expect(panel.style.width).toBe('416px');
    expect(corner.getAttribute('aria-valuenow')).toBe('416');
    expect(screen.getByRole('status').textContent).toBe('416 × 300');

    // Shift is the fine step, for lining a window up exactly.
    fireEvent.keyDown(corner, { key: 'ArrowLeft', shiftKey: true });
    expect(panel.style.width).toBe('412px');
  });

  it('leaves the window buttons out unless they are asked for', () => {
    render(
      <ModalShell label="Ajustes" theme={mockTheme} onClose={() => {}} closeButtonLabel="Cerrar">
        <p>contenido</p>
      </ModalShell>,
    );
    expect(screen.queryByLabelText('Minimizar')).toBeNull();
    expect(screen.getByLabelText('Cerrar')).toBeTruthy();
  });
});
