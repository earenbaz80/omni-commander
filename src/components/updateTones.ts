/**
 * The colours the update controls wear, written once.
 *
 * Downloading an offered update and restarting into a finished one are the only
 * two states that ask for a click, and the header chip and the settings card say
 * so with the same pair of colours. Keeping them here means a change of palette
 * lands in both places instead of drifting between them.
 */
export const UPDATE_TONE = {
  /** An update was offered: one click downloads it. */
  download: 'border-emerald-400/50 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200',
  /** A download finished: one click restarts into it. */
  install: 'border-amber-400/50 bg-amber-400/20 hover:bg-amber-400/30 text-amber-200',
} as const;
