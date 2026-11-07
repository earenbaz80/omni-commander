// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// The script is CommonJS (it runs straight from `node scripts/check-links.cjs`),
// so load it the way Node would instead of relying on ESM interop.
const loadCjs = createRequire(import.meta.url);
const { slugsOf, anchorsOfText } = loadCjs('./check-links.cjs') as {
  slugsOf: (markdown: string) => string[];
  anchorsOfText: (markdown: string) => Set<string>;
};

describe('slugsOf', () => {
  it('turns a heading into the anchor GitHub gives it', () => {
    expect(slugsOf('## Variables de entorno\n')).toEqual(['variables-de-entorno']);
  });

  it('keeps accented letters, which GitHub keeps too', () => {
    expect(slugsOf('### Última corrida y qué pasó\n')).toEqual(['última-corrida-y-qué-pasó']);
  });

  it('drops punctuation but keeps hyphens and underscores', () => {
    expect(slugsOf('## ¿Qué hace `npm run check:links`?\n')).toEqual(['qué-hace-npm-run-checklinks']);
    expect(slugsOf('## check:links\n')).toEqual(['checklinks']);
    expect(slugsOf('## snake_case y kebab-case\n')).toEqual(['snake_case-y-kebab-case']);
  });

  it('reduces a link in a heading to its text', () => {
    expect(slugsOf('## Ver [Plataforma](../README.md#plataforma)\n')).toEqual(['ver-plataforma']);
  });

  it('numbers repeated headings the way GitHub does', () => {
    expect(slugsOf('# Notas\n\n# Notas\n\n# Notas\n')).toEqual(['notas', 'notas-1', 'notas-2']);
  });

  it('ignores a hash that is only a comment inside a fenced block', () => {
    expect(slugsOf('```sh\n# not a heading\n```\n\n## Real\n')).toEqual(['real']);
  });

  it('reads setext headings and does not take a horizontal rule for one', () => {
    expect(slugsOf('Título\n======\n\npárrafo\n\n---\n')).toEqual(['título']);
  });

  it('ignores a heading quoted in a blockquote, which has no anchor', () => {
    expect(slugsOf('> ## Citado\n')).toEqual([]);
  });
});

describe('anchorsOfText', () => {
  it('accepts an explicit anchor as well as every heading', () => {
    const anchors = anchorsOfText('<a id="a-mano"></a>\n\n## Sección\n\n<a name="otra"></a>\n');

    expect([...anchors].sort()).toEqual(['a-mano', 'otra', 'sección']);
  });
});
