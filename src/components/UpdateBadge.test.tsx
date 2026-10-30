import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { UpdateBadge } from './UpdateBadge';

type Listener = (snapshot: unknown) => void;

function installBridge(state: unknown) {
  const listeners = new Set<Listener>();
  const bridge = {
    checkForUpdates: vi.fn(async () => state),
    downloadUpdate: vi.fn(async () => ({ ...(state as object), status: 'downloading' })),
    installUpdate: vi.fn(async () => true),
    getUpdateState: vi.fn(async () => state),
    onUpdateState: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = bridge;
  return bridge;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('UpdateBadge', () => {
  it('no se ve mientras no haya nada que decidir', async () => {
    const bridge = installBridge({ status: 'up-to-date', version: null, percent: 0, error: null });
    const { container } = render(<UpdateBadge lang="es" />);

    await waitFor(() => expect(bridge.getUpdateState).toHaveBeenCalled());
    expect(container.querySelector('button')).toBeNull();
  });

  it('con una versión disponible muestra el número y descarga al pulsar', async () => {
    const bridge = installBridge({ status: 'available', version: '1.0.9', percent: 0, error: null });
    render(<UpdateBadge lang="es" />);

    const chip = await screen.findByTitle('Versión 1.0.9 disponible');
    expect(chip.textContent).toContain('v1.0.9');
    fireEvent.click(chip);
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('muestra el avance de la descarga sin ofrecer botones', async () => {
    installBridge({ status: 'downloading', version: '1.0.9', percent: 42, error: null });
    render(<UpdateBadge lang="es" />);

    expect(await screen.findByText('Descargando 42%')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cuando la descarga termina, ofrece reiniciar e instalar', async () => {
    const bridge = installBridge({ status: 'downloaded', version: '1.0.9', percent: 100, error: null });
    render(<UpdateBadge lang="es" />);

    const restart = await screen.findByTitle('Reiniciar e instalar');
    fireEvent.click(restart);
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('fuera de Electron no renderiza nada', () => {
    const { container } = render(<UpdateBadge lang="es" />);
    expect(container.innerHTML).toBe('');
  });
});
