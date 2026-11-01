// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeProtectedFolders } from './useSettings';

/**
 * Settings saved by an older build keep the folder passwords as typed. They are
 * read here rather than dropped, because dropping them would silently unprotect
 * folders the user believes are locked.
 */
describe('normalizeProtectedFolders', () => {
  it('lee un valor en claro antiguo como un registro sin sal', () => {
    expect(normalizeProtectedFolders({ 'C:\\privado': 'secreta' })).toEqual({
      'C:\\privado': { salt: '', hash: 'secreta' },
    });
  });

  it('conserva los registros derivados tal y como se guardaron', () => {
    const record = { salt: 'abc', hash: 'def' };
    expect(normalizeProtectedFolders({ 'D:\\x': record })).toEqual({ 'D:\\x': record });
  });

  it('descarta lo que no es ni una cadena ni un registro utilizable', () => {
    expect(normalizeProtectedFolders({ a: 42, b: null, c: { hash: '' }, d: { hash: 'ok' } })).toEqual({
      d: { salt: '', hash: 'ok' },
    });
  });

  it('empieza vacío cuando no hay nada guardado', () => {
    expect(normalizeProtectedFolders(undefined)).toEqual({});
    expect(normalizeProtectedFolders('basura')).toEqual({});
  });
});
