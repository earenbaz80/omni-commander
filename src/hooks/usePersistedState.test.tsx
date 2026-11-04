import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePersistedState } from './usePersistedState';
import type { StoredSpec } from '../services/storage';

const KEY = 'test.persisted';

const numberSpec: StoredSpec<number> = {
  fallback: 0,
  validate: (value): value is number => typeof value === 'number' && Number.isFinite(value),
  version: 1,
};

describe('usePersistedState', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the stored value', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, value: 42 }));
    const { result } = renderHook(() => usePersistedState<number>(KEY, numberSpec));
    expect(result.current[0]).toBe(42);
  });

  it('starts from the fallback when the stored value is corrupt', () => {
    localStorage.setItem(KEY, '{not json');
    const { result } = renderHook(() => usePersistedState<number>(KEY, numberSpec));
    expect(result.current[0]).toBe(0);
  });

  it('writes a change back inside the envelope', () => {
    const { result } = renderHook(() => usePersistedState<number>(KEY, numberSpec));
    act(() => result.current[1](7));
    expect(result.current[0]).toBe(7);
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({ version: 1, value: 7 });
  });

  // Writing on mount would make a key that did not exist appear holding the
  // default, and "never set" would stop being distinguishable from "set to the
  // default" for anything that reads the key afterwards.
  it('leaves a missing key absent until the value changes', () => {
    renderHook(() => usePersistedState<number>(KEY, numberSpec));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
