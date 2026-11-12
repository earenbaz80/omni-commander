/** Human-readable size for the disk views, in the decimal-prefix units they show. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
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
 * The properties and hover views' form: two decimals down to the byte, with the
 * exact count in brackets behind it. They are the place a user checks a figure
 * against another one, so the rounded size and the raw count sit together and
 * neither has to be guessed from the other.
 */
export function formatBytesDetailed(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB (${bytes.toLocaleString()} bytes)`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString()} bytes)`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB (${bytes.toLocaleString()} bytes)`;
  return `${bytes} bytes`;
}

/**
 * The info drawer's form: two decimals up to gigabytes and no byte count after
 * the figure. The drawer prints several sizes side by side -- total, free, used
 * and the selection -- and the bracketed count that the properties window wants
 * would crowd those rows without adding anything to them.
 */
export function formatBytesTwoDecimals(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

/**
 * The map cache's form: megabytes with one decimal, a kilobyte rounded to a
 * whole unit, and a raw byte count below that. A tile cache is measured in
 * megabytes and reads as a rough figure there, so half a kilobyte of precision
 * would be a claim the number does not back; gigabytes stay counted in
 * megabytes because a cache that large means a setting was left alone.
 */
export function formatBytesWithWholeKilobytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The size ceiling in an error message: whole megabytes when the server picked a
 * round limit, one decimal when it did not. A ceiling is a rule the user is
 * being told about, not a measurement, so it keeps the unit the server states
 * and never turns into "1.0 GB" for a limit written as `1024 MB`.
 */
export function formatBytesInMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

const ROUNDED_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function splitRounded(bytes: number): { value: number; unit: number } {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < ROUNDED_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return { value, unit };
}

/**
 * The transfer prompts' form: below ten the value keeps one decimal, from ten it
 * is rounded to a whole unit, and a terabyte is its own unit. The copy and
 * conflict windows list a dozen sizes in a column, and the shorter the number
 * the less the eye has to parse to compare two of them.
 */
export function formatBytesRounded(bytes: number): string {
  const { value, unit } = splitRounded(bytes);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${ROUNDED_UNITS[unit]}`;
}

/**
 * The transfer window's form: the same rounded figure, except that a handful of
 * bytes stays a whole number -- "5 B", not "5.0 B", since a decimal there
 * claims a precision the progress bar does not have -- and a missing or negative
 * size reads as nothing transferred rather than as a broken number.
 */
export function formatBytesRoundedWithWholeBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const { value, unit } = splitRounded(bytes);
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${ROUNDED_UNITS[unit]}`;
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
