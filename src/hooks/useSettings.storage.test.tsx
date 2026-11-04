import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSettings } from './useSettings';

const KEY = 'nc_settings_v1';

describe('useSettings storage', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the defaults when nothing is saved', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.language).toBe('es');
    expect(result.current.settings.protectedFolders).toEqual({});
  });

  // Every build before the envelope wrote the bare object, so this is the shape
  // an upgrade actually finds on disk.
  it('reads the bare object an older build wrote', () => {
    localStorage.setItem(KEY, JSON.stringify({ language: 'en', fontSize: 'large' }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.language).toBe('en');
    expect(result.current.settings.fontSize).toBe('large');
    // A key the saved object does not carry keeps its default.
    expect(result.current.settings.theme).toBe('classic_blue');
  });

  it('reads the versioned envelope this build writes', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, value: { language: 'de' } }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.language).toBe('de');
  });

  it('falls back to the defaults when the saved value is corrupt', () => {
    localStorage.setItem(KEY, '{not json');
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.language).toBe('es');
  });

  // Dropping a plain-text password would silently unprotect a folder the user
  // believes is locked, so it is read as a saltless record instead.
  it('keeps a legacy plain-text folder password as a record without salt', () => {
    localStorage.setItem(KEY, JSON.stringify({ protectedFolders: { 'C:\\privado': 'secreta' } }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.protectedFolders['C:\\privado']).toEqual({ salt: '', hash: 'secreta' });
  });
});
