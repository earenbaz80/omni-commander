import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useElevation } from './useElevation';

const { fetchSystemStats } = vi.hoisted(() => ({ fetchSystemStats: vi.fn() }));
vi.mock('../services/systemStats', () => ({ fetchSystemStats }));

const bridge = { relaunchAsAdmin: vi.fn() };
const globalWithBridge = window as unknown as { electronAPI?: typeof bridge };

beforeEach(() => {
  fetchSystemStats.mockReset();
  bridge.relaunchAsAdmin.mockReset();
  delete globalWithBridge.electronAPI;
});

afterEach(() => {
  delete globalWithBridge.electronAPI;
});

describe('useElevation', () => {
  it('reports what the server says about this process', async () => {
    fetchSystemStats.mockResolvedValue({ elevated: true });
    const { result } = renderHook(() => useElevation());
    await waitFor(() => expect(result.current.isElevated).toBe(true));
  });

  it('stays not elevated when the server cannot answer', async () => {
    fetchSystemStats.mockResolvedValue(null);
    const { result } = renderHook(() => useElevation());
    await waitFor(() => expect(fetchSystemStats).toHaveBeenCalled());
    expect(result.current.isElevated).toBe(false);
  });

  it('asks the main process for an elevated restart', async () => {
    fetchSystemStats.mockResolvedValue(null);
    bridge.relaunchAsAdmin.mockResolvedValue(undefined);
    globalWithBridge.electronAPI = bridge;

    const { result } = renderHook(() => useElevation());
    await act(async () => {
      await result.current.requestElevation();
    });

    expect(bridge.relaunchAsAdmin).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a browser build, where there is no bridge', async () => {
    fetchSystemStats.mockResolvedValue(null);
    const { result } = renderHook(() => useElevation());
    await expect(result.current.requestElevation()).resolves.toBeUndefined();
  });
});
