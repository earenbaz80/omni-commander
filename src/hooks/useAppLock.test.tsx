import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppLock, type AppLockSettings } from './useAppLock';

const closed: AppLockSettings = { enabled: false, passwordHash: '' };
const locked: AppLockSettings = { enabled: true, passwordHash: 'pbkdf2:record' };

describe('useAppLock', () => {
  it('starts open when the lock was never enabled', () => {
    const { result } = renderHook((props: AppLockSettings) => useAppLock(props), { initialProps: closed });
    expect(result.current.isAppLocked).toBe(false);
  });

  it('starts locked when a password already exists at launch', () => {
    const { result } = renderHook((props: AppLockSettings) => useAppLock(props), { initialProps: locked });
    expect(result.current.isAppLocked).toBe(true);
  });

  it('refuses to lock without a password that could open it again', () => {
    const { result } = renderHook((props: AppLockSettings) => useAppLock(props), {
      initialProps: { enabled: true, passwordHash: '' },
    });
    act(() => result.current.lock());
    expect(result.current.isAppLocked).toBe(false);
  });

  it('locks, and unlocks when the password verified', () => {
    const { result } = renderHook((props: AppLockSettings) => useAppLock(props), {
      initialProps: { enabled: true, passwordHash: '' },
    });

    act(() => result.current.unlock());
    expect(result.current.isAppLocked).toBe(false);

    const withPassword: AppLockSettings = { enabled: true, passwordHash: 'pbkdf2:record' };
    const { result: second } = renderHook((props: AppLockSettings) => useAppLock(props), {
      initialProps: withPassword,
    });
    act(() => second.current.unlock());
    expect(second.current.isAppLocked).toBe(false);
    act(() => second.current.lock());
    expect(second.current.isAppLocked).toBe(true);
  });

  it('locks at once when the setting is enabled while the app is open', () => {
    const { result, rerender } = renderHook((props: AppLockSettings) => useAppLock(props), {
      initialProps: { enabled: false, passwordHash: 'pbkdf2:record' },
    });
    expect(result.current.isAppLocked).toBe(false);

    rerender({ enabled: true, passwordHash: 'pbkdf2:record' });
    expect(result.current.isAppLocked).toBe(true);
  });

  it('does not re-lock on an unrelated settings change', () => {
    const { result, rerender } = renderHook((props: AppLockSettings) => useAppLock(props), { initialProps: locked });
    act(() => result.current.unlock());
    expect(result.current.isAppLocked).toBe(false);

    rerender({ enabled: true, passwordHash: 'pbkdf2:record' });
    expect(result.current.isAppLocked).toBe(false);
  });
});
