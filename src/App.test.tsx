import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

/**
 * Drag-drop moves used to run their cleanup block twice: the async IIFE did it
 * correctly after the loop, and an identical synchronous copy fired right after,
 * so `playSuccess` + the pane refresh ran before any transfer had started and
 * the move-success sound also played for copies. This pins the observable
 * contract of `handleDropItems`: one success sound, only for a move, and only
 * after the operation actually resolves.
 *
 * `handleDropItems` is not exported, so the smallest render that exercises it is
 * `<App />` itself. PanelView is mocked purely to capture the `onDropItems`
 * handler App passes down, which avoids simulating the whole FileList drag
 * pipeline (dataTransfer JSON, directory items, folder-into-itself filtering)
 * that the drop contract does not depend on.
 */

let capturedOnDropItems: ((items: any[], path: string, driveId: string, op: 'copy' | 'move') => void) | null = null;

vi.mock('./components/PanelView', () => ({
  PanelView: (props: any) => {
    capturedOnDropItems = props.onDropItems;
    return React.createElement('div', { 'data-testid': `panel-${props.side}` });
  },
}));

// A quiet, observable sound layer: no Web Audio, just call counts.
const playSuccess = vi.fn();
vi.mock('./services/soundEffects', () => ({
  soundManager: {
    playSuccess: (...a: unknown[]) => playSuccess(...a),
    playDiskAccess: vi.fn(),
    playKeyTick: vi.fn(),
    playBeep: vi.fn(),
    playSelectSound: vi.fn(),
    playError: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
  },
}));

import App from './App';
import { fsEngine } from './services/fileSystem';
import { FileItem } from './types';

// jsdom does not implement matchMedia; usePWAInstall calls it during render.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const item = (id: string): FileItem => ({
  id,
  name: id,
  ext: '',
  path: 'C:\\',
  driveId: 'real_A',
  isDirectory: false,
  size: 1,
  modifiedAt: '',
  createdAt: '',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
});

afterEach(() => {
  cleanup();
  capturedOnDropItems = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('App handleDropItems', () => {
  it('plays the move-success sound once for a move, only after the operation resolves', async () => {
    render(<App />);
    expect(capturedOnDropItems).toBeTypeOf('function');

    let resolveMove: () => void = () => {};
    vi.spyOn(fsEngine, 'transferPaths').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMove = () => resolve();
        }),
    );

    await act(async () => {
      capturedOnDropItems!([item('f1')], 'C:\\dest', 'real_A', 'move');
    });

    // Dispatched but unresolved: any success sound here is the premature bug.
    expect(playSuccess).toHaveBeenCalledTimes(0);

    await act(async () => {
      resolveMove();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(playSuccess).toHaveBeenCalledTimes(1);
  });

  it('never plays the move-success sound for a copy', async () => {
    render(<App />);
    vi.spyOn(fsEngine, 'transferPaths').mockResolvedValue(undefined);

    await act(async () => {
      capturedOnDropItems!([item('f2')], 'C:\\dest', 'real_A', 'copy');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(playSuccess).toHaveBeenCalledTimes(0);
  });
});
