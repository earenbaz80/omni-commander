import { readStored, writeStored, type StoredSpec } from './storage';

/**
 * What happens to a transfer window once the transfer finishes.
 *
 * Closing it on its own is convenient for fire-and-forget copies and hostile for
 * everything else, so it is always an explicit choice, remembered across
 * sessions. The two windows that offer it each kept their own copy of the key and
 * their own reader; this is the one place that decides what a stored value means.
 */
export type AfterFinish = 'stay' | 'close' | 'ask';

const KEY = 'omnicommander.afterFinish';

const isAfterFinish = (value: unknown): value is AfterFinish =>
  value === 'stay' || value === 'close' || value === 'ask';

const SPEC: StoredSpec<AfterFinish> = {
  // Staying is the safe answer: a window that closes itself takes the report of
  // what happened with it.
  fallback: 'stay',
  validate: isAfterFinish,
  version: 1,
  // Older builds saved the bare word, which is not JSON at all, so the value
  // arrives here as raw text and is recognised as it stands.
  migrate: (value) => (isAfterFinish(value) ? value : null),
};

export const readAfterFinishChoice = (): AfterFinish => readStored(KEY, SPEC);

/** Remembers the choice; a full quota costs the reminder, never the transfer. */
export const writeAfterFinishChoice = (choice: AfterFinish): void => {
  writeStored(KEY, choice, SPEC.version ?? 1);
};
