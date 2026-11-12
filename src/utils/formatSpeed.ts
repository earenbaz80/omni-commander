/**
 * Transfer speed as the queue and the monitor print it: megabytes per second,
 * one decimal, and no trailing ".0" when the figure is whole.
 *
 * The producers are two -- a measured rate, which moves by tenths, and a cap the
 * user picked, which is always a whole number of megabytes -- and the two used
 * to be built apart, so a cap read "5 MB/s" while the same speed measured read
 * "5.0 MB/s". Dropping the zero keeps both honest without a second function.
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond < 0) return '0 MB/s';
  const megabytes = (bytesPerSecond / (1024 * 1024)).toFixed(1);
  return `${megabytes.endsWith('.0') ? megabytes.slice(0, -2) : megabytes} MB/s`;
}
