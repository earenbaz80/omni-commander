// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// The generator is CommonJS so the workflow can run it with plain `node`, which
// is also the shape the publishing step invokes.
const loadCjs = createRequire(import.meta.url);
const { buildNotes, groupCommits, parseCommits, summaryOf, countsOf } = loadCjs('./release-notes.cjs') as {
  buildNotes: (input: {
    tag: string;
    previousTag?: string | null;
    commits?: Commit[];
    repository?: string | null;
  }) => string;
  summaryOf: (commits: Commit[]) => string;
  countsOf: (commits: Commit[]) => string;
  groupCommits: (commits: Commit[]) => Array<{ title: string; commits: Commit[] }>;
  parseCommits: (output: string) => Commit[];
};

interface Commit {
  sha: string;
  subject: string;
  body: string;
}

const commit = (subject: string, sha = 'a'.repeat(40), body = ''): Commit => ({ sha, subject, body });

/** The wire format `git log --pretty=format:%H%x1f%s%x1f%b%x1e` writes. */
const records = (...entries: Commit[]) =>
  entries.map((entry) => `${entry.sha}\x1f${entry.subject}\x1f${entry.body}\x1e`).join('\n');

describe('parseCommits', () => {
  it('reads the sha, the subject and the body of every record', () => {
    const sha = '1234567890abcdef1234567890abcdef12345678';
    const parsed = parseCommits(records(commit('feat(panel): add a tab', sha, 'Why it was needed.')));
    expect(parsed).toEqual([{ sha, subject: 'feat(panel): add a tab', body: 'Why it was needed.' }]);
  });

  it('drops merge commits, which say how the history was built rather than what changed', () => {
    expect(parseCommits(records(commit('Merge branch master'), commit('fix(server): keep the port')))).toHaveLength(1);
  });

  it('handles an empty log without inventing a commit', () => {
    expect(parseCommits('')).toEqual([]);
  });
});

describe('groupCommits', () => {
  it('sorts the conventional types into their sections, in a fixed order', () => {
    const groups = groupCommits([
      commit('docs(release): note the check'),
      commit('fix(catalog): compare by identity'),
      commit('feat(platform): add adapters'),
    ]);
    expect(groups.map((group) => group.title)).toEqual(['Nuevas funciones', 'Correcciones', 'Mantenimiento']);
  });

  it('leaves out the version bump, which is the release itself', () => {
    const groups = groupCommits([commit('chore(release): cut 1.0.49'), commit('fix(panel): keep the row key')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].commits.map((entry) => entry.subject)).toEqual(['fix(panel): keep the row key']);
  });

  it('keeps a subject that is not conventional instead of losing it', () => {
    const groups = groupCommits([commit('Tidy the workflow by hand')]);
    expect(groups).toEqual([{ title: 'Mantenimiento', commits: [commit('Tidy the workflow by hand')] }]);
  });

  it('omits the sections nothing landed in', () => {
    expect(groupCommits([commit('perf(panel): skip the second pass')]).map((group) => group.title)).toEqual([
      'Rendimiento',
    ]);
  });
});

describe('countsOf', () => {
  it('counts by type, most frequent first, then alphabetically', () => {
    expect(
      countsOf([
        commit('docs(release): a'),
        commit('docs(release): b'),
        commit('test(catalog): c'),
        commit('An unconventional subject'),
      ]),
    ).toBe('2 docs, 1 otros, 1 test');
  });
});

describe('buildNotes', () => {
  it('writes a body that names the range, the sections and a link per commit', () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    const notes = buildNotes({
      tag: 'v1.0.50',
      previousTag: 'v1.0.49',
      repository: 'earenbaz80/omni-commander',
      commits: [commit('fix(panel): keep the row key', sha)],
    });
    expect(notes).toContain('Cambios desde `v1.0.49` hasta `v1.0.50`.');
    expect(notes).toContain('### Correcciones');
    expect(notes).toContain(
      `- fix(panel): keep the row key ([\`abcdef1\`](https://github.com/earenbaz80/omni-commander/commit/${sha}))`,
    );
    expect(notes).toContain(
      '**Comparar los cambios**: https://github.com/earenbaz80/omni-commander/compare/v1.0.49...v1.0.50',
    );
  });

  it('falls back to the short sha when no repository is known, as when run locally', () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    const notes = buildNotes({ tag: 'v1.0.50', previousTag: 'v1.0.49', commits: [commit('fix: x', sha)] });
    expect(notes).toContain('- fix: x (`abcdef1`)');
    expect(notes).not.toContain('https://github.com/');
  });

  it('folds maintenance into a collapsed block that still lists every commit', () => {
    const notes = buildNotes({
      tag: 'v1.0.50',
      previousTag: 'v1.0.49',
      repository: 'owner/name',
      commits: [
        commit('fix(panel): keep the row key'),
        commit('docs(release): close the check'),
        commit('docs(release): sync the notes'),
        commit('test(catalog): cover the edges'),
        commit('refactor(panel): spell the path'),
      ],
    });
    expect(notes).toContain('<details>');
    expect(notes).toContain('<summary>Mantenimiento (4 commits: 2 docs, 1 refactor, 1 test)</summary>');
    expect(notes).not.toContain('### Mantenimiento');
    for (const subject of [
      'docs(release): close the check',
      'docs(release): sync the notes',
      'test(catalog): cover the edges',
      'refactor(panel): spell the path',
    ]) {
      expect(notes).toContain(subject);
    }
    expect(notes.indexOf('<details>')).toBeGreaterThan(notes.indexOf('### Correcciones'));
    expect(notes.indexOf('</details>')).toBeGreaterThan(notes.indexOf('<details>'));
  });

  it('counts what is folded away by type, most frequent first', () => {
    expect(
      summaryOf([
        commit('docs(release): a'),
        commit('docs(release): b'),
        commit('test(catalog): c'),
        commit('refactor(panel): d'),
        commit('An unconventional subject'),
      ]),
    ).toBe('5 commits: 2 docs, 1 otros, 1 refactor, 1 test');
  });

  it('keeps the sections a user reads as headings', () => {
    const notes = buildNotes({
      tag: 'v1.0.50',
      previousTag: 'v1.0.49',
      commits: [commit('feat(panel): add a tab'), commit('fix(panel): keep the row key')],
    });
    expect(notes).toContain('### Nuevas funciones');
    expect(notes).toContain('### Correcciones');
    expect(notes).not.toContain('<details>');
  });

  it('states in one visible line what a release with no product changes contains', () => {
    const notes = buildNotes({
      tag: 'v1.0.50-beta.1',
      previousTag: 'v1.0.49',
      repository: 'owner/name',
      commits: [
        commit('ci(release): let the notes step run without a tag'),
        commit('docs(release): record the cut'),
        commit('docs(release): record the body'),
      ],
    });
    expect(notes).toContain('Sin cambios de producto: 3 commits de mantenimiento (2 docs, 1 ci).');
    // The line is outside the block, so it is visible without opening anything.
    expect(notes.indexOf('Sin cambios de producto')).toBeLessThan(notes.indexOf('<details>'));
    expect(notes).toContain('<summary>Mantenimiento (3 commits: 2 docs, 1 ci)</summary>');
    for (const subject of [
      'ci(release): let the notes step run without a tag',
      'docs(release): record the cut',
      'docs(release): record the body',
    ]) {
      expect(notes).toContain(subject);
    }
  });

  it('leaves that line out when a product section is present', () => {
    const notes = buildNotes({
      tag: 'v1.0.50',
      previousTag: 'v1.0.49',
      commits: [commit('fix(panel): keep the row key'), commit('docs(release): record the cut')],
    });
    expect(notes).not.toContain('Sin cambios de producto');
    expect(notes).toContain('### Correcciones');
  });

  it('describes a first release without a comparison range', () => {
    const notes = buildNotes({ tag: 'v1.0.1', commits: [commit('feat: begin')], repository: 'owner/name' });
    expect(notes).toContain('Primer release, `v1.0.1`.');
    expect(notes).not.toContain('Comparar los cambios');
  });

  it('refuses to write an empty body, which is what the step exists to prevent', () => {
    expect(() =>
      buildNotes({ tag: 'v1.0.50', previousTag: 'v1.0.49', commits: [commit('chore(release): cut 1.0.50')] }),
    ).toThrow(/no release body to write/);
  });
});
