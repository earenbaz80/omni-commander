/**
 * A countdown short enough to sit in a menu row or a tooltip.
 *
 * The tray and the toasts both report a bounded wait, and both need the same shape
 * for it: minutes and seconds, never a raw millisecond count.
 */
function clockOf(ms) {
  const total = Math.max(0, Math.ceil(Number(ms) / 1000));
  return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
}

module.exports = { clockOf };
