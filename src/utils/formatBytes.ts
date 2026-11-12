/** Human-readable size for the disk views, in the decimal-prefix units they show. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * The drive bar's form: a terabyte keeps its own unit instead of counting in
 * thousands of gigabytes, and anything under a megabyte stays a raw byte count,
 * because a free-space figure that small is a nearly full disk rather than a
 * size worth a unit.
 */
export function formatBytesWithTerabytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${bytes} B`;
}

/**
 * The transfer prompts' form: below ten the value keeps one decimal, from ten it
 * is rounded to a whole unit, and a terabyte is its own unit. The copy and
 * conflict windows list a dozen sizes in a column, and the shorter the number
 * the less the eye has to parse to compare two of them.
 */
export function formatBytesRounded(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * The listing's size column: one letter, no space, and a bare number under a
 * kilobyte. The column repeats on every row of a narrow panel, so `1.5 G` is
 * both what fits and what that column has always shown.
 */
export function formatBytesCompact(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} G`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} k`;
  return `${bytes}`;
}
