// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { matchesPanelFilter, panelFilterPattern } from './panelFilter';

/**
 * The quick filter is the only search a panel has, so a filter that quietly
 * means something else is worse than one that fails: the user sees an empty
 * list and concludes the file is gone.
 */

const file = (name: string, ext = '') => ({ name, ext });

const matches = (name: string, filter: string, ext = '') => matchesPanelFilter(file(name, ext), filter);

describe('matchesPanelFilter', () => {
  it('trata * y ? como comodines', () => {
    expect(matches('report.txt', '*.txt', 'txt')).toBe(true);
    expect(matches('report.doc', '*.txt', 'doc')).toBe(false);
    // `?` is exactly one character.
    expect(matches('abc', 'a?c')).toBe(true);
    expect(matches('ac', 'a?c')).toBe(false);
    expect(matches('abbc', 'a?c')).toBe(false);
  });

  it('ancla el patrón al nombre completo', () => {
    // Without the anchors `*.txt` would also swallow `a.txt.bak`.
    expect(matches('a.txt.bak', '*.txt')).toBe(false);
    expect(panelFilterPattern('*.txt').test('a.txt.bak')).toBe(false);
  });

  it('toma literalmente los caracteres especiales de una expresión regular', () => {
    // These all compiled fine before and meant something else.
    expect(matches('a+b', 'a+b')).toBe(true);
    expect(matches('ab', 'a+b')).toBe(false);
    expect(matches('aab', 'a+b')).toBe(false);

    expect(matches('[x]', '[x]')).toBe(true);
    expect(matches('x', '[x]')).toBe(false);

    expect(matches('(1)', '(1)')).toBe(true);
    expect(matches('report|draft', 'report|draft')).toBe(true);
    expect(matches('report', 'report|draft')).toBe(false);
    expect(matches('back\\slash', 'back\\slash')).toBe(true);
  });

  it('sigue encontrando por subcadena sin comodines', () => {
    expect(matches('report.txt', 'port')).toBe(true);
    expect(matches('informe.txt', 'INFORME')).toBe(true);
  });

  it('no filtra nada con la consulta vacía', () => {
    expect(matches('cualquiera.txt', '')).toBe(true);
    expect(matches('cualquiera.txt', '   ')).toBe(true);
  });

  it('compara el nombre con la extensión cuando están separados', () => {
    // The list shows the extension in its own column, so `name` may arrive bare.
    expect(matches('report', '*.txt', 'txt')).toBe(true);
    expect(matches('report', '*.zip', 'txt')).toBe(false);
  });
});
