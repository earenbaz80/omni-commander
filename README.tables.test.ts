// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * README.md is prose and Prettier skips it (`.prettierignore` lists `*.md`), so
 * nothing in the toolchain notices when a table drifts. Adding a row with longer
 * text leaves the columns ragged in the raw markdown, and those tables are read
 * in a terminal and in diffs far more often than they are rendered.
 *
 * So this guard reads the file and checks every table twice over: well formed
 * (same cell count on every row, a real delimiter row second) and padded to a
 * shared column width. The padding rule is the one the file has always followed
 * by hand: every cell carries spaces up to the widest content of its column,
 * header included, and the delimiter row is as wide as the column it separates.
 *
 * Pipe characters inside fenced code blocks are ignored: a README may well show
 * an example table, and an example is not a table to keep aligned.
 */

const README = path.join(path.dirname(fileURLToPath(import.meta.url)), 'README.md');

/** A markdown table row: it opens and closes with a pipe. */
const isRow = (line: string) => /^\|.*\|\s*$/.test(line);

/** Cell contents, padding and line ending trimmed away. */
const cellsOf = (line: string) =>
  line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

/**
 * Each column as laid out in the file, padding included: the segments between
 * the pipes, with the pipe framing's own two spaces still in them. Two cells in
 * the same column are aligned exactly when these have the same length.
 */
const segmentsOf = (line: string) => line.trim().slice(1, -1).split('|');

const isDelimiterRow = (cells: string[]) => cells.every((cell) => /^:?-+:?$/.test(cell));

/**
 * Every problem found, as readable text. Callers assert on the whole list rather
 * than on the first failure, so one edit that breaks four columns is one run.
 */
function checkTables(markdown: string): string[] {
  const lines = markdown.split('\n');
  const problems: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length;) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (inFence || !isRow(lines[i])) {
      i++;
      continue;
    }

    // The whole table at once: checking column widths one row at a time would
    // flag every sibling as soon as a single row grows.
    let end = i;
    while (end < lines.length && isRow(lines[end])) end++;
    checkTable(lines.slice(i, end), i + 1, problems);
    i = end;
  }

  return problems;
}

function checkTable(block: string[], firstLine: number, problems: string[]): void {
  const cells = block.map(cellsOf);
  const segments = block.map(segmentsOf);
  const header = cells[0];

  cells.forEach((row, index) => {
    if (row.length !== header.length) {
      problems.push(`line ${firstLine + index}: the header has ${header.length} cells but this row has ${row.length}`);
    }
  });

  if (!isDelimiterRow(cells[1] || [])) {
    problems.push(
      `line ${firstLine + 1}: the second row of a table must be the delimiter row (| --- | --- |), got "${block[1]}"`,
    );
    // Without a delimiter row the widths below would be compared against data
    // that is not laid out as columns yet: report the shape problem and stop.
    return;
  }

  for (let column = 0; column < header.length; column++) {
    // Content width, not segment width: the two framing spaces are not padding
    // the author wrote, and "rows are 1, 3 wide" is the wording they can act on.
    const contentWidth = (row: string[]) => (row[column]?.length ?? 2) - 2;

    // The delimiter row is left out here and checked on its own below, so a
    // wrong one is reported as such instead of as one more unruly row.
    const distinct = [...new Set(segments.filter((_, index) => index !== 1).map(contentWidth))].sort((a, b) => a - b);
    const target = distinct[distinct.length - 1];

    if (distinct.length > 1) {
      problems.push(
        `line ${firstLine}: column ${column + 1} ("${header[column]}") is ragged: rows are ${distinct.join(', ')} wide, ` +
          `and every row in a column is padded to the same width (${target})`,
      );
    }

    const dashes = contentWidth(segments[1] || []);
    if (dashes !== target) {
      problems.push(
        `line ${firstLine + 1}: the delimiter of column ${column + 1} is ${dashes} dashes wide but the column is ` +
          `${target}`,
      );
    }
  }
}

describe('README tables', () => {
  // A moved or renamed README would otherwise leave this guard passing over an
  // empty list of tables forever.
  it('are there to be guarded', () => {
    const delimiters = readFileSync(README, 'utf8')
      .split('\n')
      .filter((line) => isRow(line) && isDelimiterRow(cellsOf(line)));

    expect(delimiters.length).toBeGreaterThanOrEqual(2);
  });

  it('are well formed and share a column width', () => {
    expect(checkTables(readFileSync(README, 'utf8'))).toEqual([]);
  });
});

/**
 * The guard is only worth its runtime if it actually flags the shapes it
 * describes, so each of them is fed a fixture. The last case is the one that
 * would otherwise make it cry wolf.
 */
describe('checkTables', () => {
  it('flags a column whose cells are not padded to a shared width', () => {
    const problems = checkTables(['| a   | b   |', '| --- | --- |', '| 1 | 2   |', '| 333 | 4   |'].join('\n'));

    expect(problems).toEqual([
      expect.stringMatching(/column 1 \("a"\) is ragged: rows are 1, 3 wide, .*padded to the same width \(3\)/),
    ]);
  });

  it('flags a delimiter that is not as wide as its column', () => {
    const problems = checkTables(['| a   | b   |', '| --- | -- |', '| 1   | 2   |'].join('\n'));

    expect(problems).toEqual([
      expect.stringMatching(/line 2: the delimiter of column 2 is 2 dashes wide but the column is 3/),
    ]);
  });

  it('flags a table whose second row is not a delimiter row', () => {
    const problems = checkTables(['| a | b |', '| 1 | 2 |'].join('\n'));

    expect(problems).toEqual([expect.stringMatching(/second row of a table must be the delimiter row/)]);
  });

  it('flags a row that does not have the header cell count', () => {
    // Wide enough cells that only the extra one is at fault.
    const problems = checkTables(['| aaa | bbb |', '| --- | --- |', '| 111 | 222 |', '| 333 | 444 | 555 |'].join('\n'));

    expect(problems).toEqual([expect.stringMatching(/header has 2 cells but this row has 3/)]);
  });

  it('leaves pipe tables inside fenced code blocks alone', () => {
    const problems = checkTables(['```md', '| a | b |', '| 1 | 2 |', '```'].join('\n'));

    expect(problems).toEqual([]);
  });
});
