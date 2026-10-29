// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertSafePath, isAbsoluteLocalPath } from './server/pathSafety.cjs';

/**
 * Every route asks this before it reads or writes anything, so a hostile path
 * has to stop here. It used to be buried in the single server file; the cases
 * below are the rules its comments argue for, now testable without booting the
 * server or touching a disk.
 */

describe('isAbsoluteLocalPath', () => {
  it('acepta una ruta con letra de unidad', () => {
    expect(isAbsoluteLocalPath(String.raw`C:\Windows`)).toBe(true);
    expect(isAbsoluteLocalPath('d:/temp')).toBe(true);
    // The panels address a drive root as a bare letter with a colon.
    expect(isAbsoluteLocalPath('C:')).toBe(true);
    expect(isAbsoluteLocalPath(String.raw`  C:\x  `)).toBe(true);
  });

  it('rechaza una ruta UNC, que es otro equipo por SMB', () => {
    expect(isAbsoluteLocalPath(String.raw`\\servidor\share\x`)).toBe(false);
    expect(isAbsoluteLocalPath('//servidor/share/x')).toBe(false);
  });

  it('rechaza las rutas de dispositivo', () => {
    expect(isAbsoluteLocalPath(String.raw`\\?\C:\x`)).toBe(false);
    expect(isAbsoluteLocalPath(String.raw`\\.\PhysicalDrive0`)).toBe(false);
  });

  it('rechaza lo que no es una ruta absoluta local', () => {
    expect(isAbsoluteLocalPath(String.raw`Windows\System32`)).toBe(false);
    expect(isAbsoluteLocalPath('')).toBe(false);
    expect(isAbsoluteLocalPath(undefined)).toBe(false);
    expect(isAbsoluteLocalPath('https://example.com')).toBe(false);
  });
});

describe('assertSafePath', () => {
  it('completa la raíz y normaliza las separaciones', () => {
    // A raw template cannot end in a backslash, so this one is written escaped.
    expect(assertSafePath('C:')).toBe('C:\\');
    expect(assertSafePath(String.raw`  D:\x  `)).toBe(String.raw`D:\x`);
    expect(assertSafePath('c:/temp/x')).toBe(String.raw`c:\temp\x`);
  });

  it('resuelve los segmentos relativos antes de devolver la ruta', () => {
    expect(assertSafePath(String.raw`C:\a\..\b`)).toBe(String.raw`C:\b`);
    expect(assertSafePath(String.raw`C:\a\.\b`)).toBe(String.raw`C:\a\b`);
  });

  it('se niega con el valor en el mensaje', () => {
    expect(() => assertSafePath(String.raw`\\servidor\share`)).toThrow(/Unsafe path/);
    expect(() => assertSafePath('relativa')).toThrow(/Unsafe path: relativa/);
  });
});
