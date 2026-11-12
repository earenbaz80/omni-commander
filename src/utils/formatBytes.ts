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
