import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from '../services/taskQueueManager';
import type { TraySnapshot } from '../services/trayBridge';
import type { LanguageCode } from '../types';
import { useTrayBridge } from './useTrayBridge';
import type { TransferQueue } from './useTransferQueue';

/**
 * The hook is the renderer half of the tray: it starts the bridge on mount,
 * restarts it when the language changes and stops listening on unmount. The
 * service suite already covers what each command does; here the contract is the
 * lifecycle and the snapshot the tray receives.
 */

type Bridge = {
  updateTrayState: ReturnType<typeof vi.fn<(snapshot: TraySnapshot) => void>>;
  onTrayCommand: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const installBridge = (): Bridge => {
  const updateTrayState = vi.fn<(snapshot: TraySnapshot) => void>();
  const unsubscribe = vi.fn();
  const onTrayCommand = vi.fn(() => unsubscribe);
  (window as unknown as { electronAPI?: unknown }).electronAPI = { updateTrayState, onTrayCommand };
  return { updateTrayState, onTrayCommand, unsubscribe };
};

const queueStub = () =>
  ({
    handleRunCopyList: vi.fn(),
    answerConflictFromTray: vi.fn(),
  }) as unknown as TransferQueue;

const lastSnapshot = (bridge: Bridge): TraySnapshot => {
  const snapshot = bridge.updateTrayState.mock.calls.at(-1)?.[0];
  if (!snapshot) throw new Error('The tray bridge sent no snapshot');
  return snapshot;
};

const started: string[] = [];

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  for (const id of started.splice(0)) taskQueue.cancelTask(id);
  taskQueue.clearCompleted();
});

describe('useTrayBridge', () => {
  it('mounts without an Electron bridge and unmounts cleanly', () => {
    expect((window as unknown as { electronAPI?: unknown }).electronAPI).toBeUndefined();

    const { unmount } = renderHook(() => useTrayBridge('en', queueStub()));

    expect(() => unmount()).not.toThrow();
  });

  it('sends a new snapshot when the queue changes', () => {
    const bridge = installBridge();
    renderHook(() => useTrayBridge('en', queueStub()));
    const before = bridge.updateTrayState.mock.calls.length;

    let release = () => {};
    const id = taskQueue.addTask(
      'copy',
      'Copy 2 items',
      'C:\\dest',
      1024,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    started.push(id);

    expect(bridge.updateTrayState.mock.calls.length).toBeGreaterThan(before);
    const snapshot = lastSnapshot(bridge);
    expect(snapshot.task).toMatchObject({
      id,
      title: 'Copy 2 items',
      status: 'running',
    });
    expect(snapshot.activeCount).toBe(1);

    release();
  });

  it('restarts the bridge with the new labels when the language changes', () => {
    const bridge = installBridge();
    const { rerender } = renderHook(({ lang }: { lang: LanguageCode }) => useTrayBridge(lang, queueStub()), {
      initialProps: { lang: 'en' },
    });

    expect(lastSnapshot(bridge).labels.pause).toBe(getTranslations('en').bgTasksPause);

    rerender({ lang: 'es' });

    expect(lastSnapshot(bridge).labels.pause).toBe(getTranslations('es').bgTasksPause);
    expect(bridge.onTrayCommand).toHaveBeenCalledTimes(2);
    // The old subscription is torn down before the new one is installed.
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops listening to the queue and the tray when it unmounts', () => {
    const bridge = installBridge();
    const { unmount } = renderHook(() => useTrayBridge('en', queueStub()));
    const before = bridge.updateTrayState.mock.calls.length;

    unmount();
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);

    // A task that can finish leaves no executor holding the singleton queue.
    const id = taskQueue.addTask('copy', 'Copy 2 items', 'C:\\dest', 1024, async () => {});
    started.push(id);

    expect(bridge.updateTrayState).toHaveBeenCalledTimes(before);
  });
});
