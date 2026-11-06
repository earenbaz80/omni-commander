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

  it('returns the refusal so the caller can explain it', async () => {
    fetchSystemStats.mockResolvedValue(null);
    bridge.relaunchAsAdmin.mockResolvedValue({ ok: false, reason: 'cancelled' });
    globalWithBridge.electronAPI = bridge;

    const { result } = renderHook(() => useElevation());
    let answer;
    await act(async () => {
      answer = await result.current.requestElevation();
    });

    expect(bridge.relaunchAsAdmin).toHaveBeenCalledTimes(1);
    expect(answer).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('returns a failure when the bridge itself rejects', async () => {
    fetchSystemStats.mockResolvedValue(null);
    bridge.relaunchAsAdmin.mockRejectedValue(new Error('ipc closed'));
    globalWithBridge.electronAPI = bridge;

    const { result } = renderHook(() => useElevation());
    let answer;
    await act(async () => {
      answer = await result.current.requestElevation();
    });

    expect(answer).toEqual({ ok: false, reason: 'spawn-failed', detail: 'ipc closed' });
  });

  it('says elevation is unsupported in a browser build, where there is no bridge', async () => {
    fetchSystemStats.mockResolvedValue(null);
    const { result } = renderHook(() => useElevation());
    await expect(result.current.requestElevation()).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });
});
