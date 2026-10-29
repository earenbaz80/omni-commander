import type { FileItem } from '../types';

/**
 * The panel's quick filter (Ctrl+F): `*` and `?` are wildcards and every other
 * character means itself.
 *
 * The old inline version escaped only `.`, `*` and `?`. A filter like `a+b`
 * therefore compiled to a pattern meaning "one or more a, then b": no exception,
 * so the `catch` never fired, and the search silently answered a different
 * question while ignoring the file actually named `a+b`. `[x]`, `(1)` and
 * `report|draft` behaved the same way -- valid patterns, wrong meaning. Escaping
 * every metacharacter first and re-enabling only the two wildcards keeps the
 * feature and makes everything else literal, which is also why no pattern built
 * here can fail to compile.
 */
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** The glob the filter describes, anchored so `*.txt` does not match `a.txt.bak`. */
export function panelFilterPattern(filter: string): RegExp {
  const escaped = filter.replace(REGEXP_SPECIALS, '\\$&');
  const source = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
}

/**
 * Whether a listing entry survives the filter.
 *
 * The glob has to match the whole name, and the plain substring test stays so
 * typing `port` still finds `report.txt` without a leading `*`. `name` is the
 * display split, so the `name.ext` form covers the entries whose extension the
 * list shows on its own column.
 */
export function matchesPanelFilter(item: Pick<FileItem, 'name' | 'ext'>, filter: string): boolean {
  const query = filter.trim();
  if (!query) return true;

  const pattern = panelFilterPattern(query);
  return (
    pattern.test(item.name) ||
    pattern.test(`${item.name}.${item.ext}`) ||
    item.name.toLowerCase().includes(query.toLowerCase())
  );
}
