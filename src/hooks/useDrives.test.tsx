import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive } from '../types';

/**
 * What a failed probe leaves behind.
 *
 * The list the engine boots with is the cache of the last session, not an
 * answer, so a boot whose retries all fail used to open both panels on a drive
 * the server could not list — which reads as an empty folder instead of an empty
 * machine. Once the server has answered, a later failure is a hiccup and the known
 * list stays, which is the behaviour the engine test for the poll already pins.
 */
const { state, engine } = vi.hoisted(() => {
  const state = {
    drives: [] as Drive[],
    answers: [] as Array<{ answered: boolean; drives?: Drive[] }>,
    listeners: new Set<() => void>(),
  };
  const engine = {
    getDrives: () => [...state.drives],
    setDrives: (next: Drive[]) => {
      state.drives = [...next];
      for (const listener of state.listeners) listener();
    },
    subscribe: (listener: () => void) => {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
    loadRealDrivesFromApi: async () => {
      // The real read awaits `fetch`, so the answer always lands after the hook's
      // subscription exists; a synchronous double would notify nobody.
      await Promise.resolve();
      const answer = state.answers.shift();
      if (!answer?.answered) return false;
      engine.setDrives(answer.drives ?? []);
      return true;
    },
  };
  return { state, engine };
});

vi.mock('../services/fileSystem', () => ({ fsEngine: engine }));

import { useDrives } from './useDrives';

const realDrive: Drive = {
  id: 'real_C',
  letter: 'C:',
  name: 'Windows',
  type: 'local',
  totalBytes: 100,
  freeBytes: 40,
  isMounted: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  state.drives = [];
  state.answers = [];
  state.listeners.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Lets the poll's awaited answer reach React, with no wall clock involved. */
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('useDrives boot probe', () => {
  it('drops the cached drives when the first probe never gets an answer', async () => {
    state.drives = [realDrive];
    state.answers = [{ answered: false }];

    const { result } = renderHook(() => useDrives());
    expect(result.current).toEqual([realDrive]);

    await flush();

    expect(result.current).toEqual([]);
    expect(engine.getDrives()).toEqual([]);
  });

  it('keeps a list the server already answered with when a later poll fails', async () => {
    state.answers = [{ answered: true, drives: [realDrive] }, { answered: false }];

    const { result } = renderHook(() => useDrives());
    await flush();
    expect(result.current).toEqual([realDrive]);

    // The next poll is the fast one, and it fails: a hiccup, not an empty machine.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flush();

    expect(result.current).toEqual([realDrive]);
    expect(engine.getDrives()).toEqual([realDrive]);
  });
});
