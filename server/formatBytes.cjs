/**
 * The app's size ladders, for the parts of the server that print a size.
 *
 * They are mirrors, not imports: this side runs as plain CommonJS under Node and
 * the app's module is TypeScript, so there is no way to require it. Keeping both
 * ladders here, in one file, means the server has a single copy instead of one
 * per caller, and `server.formatBytes.test.ts` holds each of them to its
 * counterpart in `src/utils/formatBytes.ts`.
 */

/**
 * The disk views' form: one decimal, and units up to a terabyte.
 * Mirrors `formatBytes`.
 */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * The transfer window's form: below ten the value keeps a decimal, from ten it is
 * rounded to a whole unit, and a handful of bytes stays whole. Mirrors
 * `formatBytesRoundedWithWholeBytes` except that it returns nothing for a size it
 * could not read; the caller decides what to print instead.
 */
function formatBytesRounded(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

module.exports = { formatBytes, formatBytesRounded };
