import { describe, it, expect, beforeEach } from 'vitest';
import { readAfterFinishChoice, writeAfterFinishChoice } from './afterFinish';

const KEY = 'omnicommander.afterFinish';

describe('afterFinish choice', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to staying when nothing is stored', () => {
    expect(readAfterFinishChoice()).toBe('stay');
  });

  // Both transfer windows wrote the bare word before this module existed, and a
  // bare word is not JSON: the migration has to read the raw text.
  it('reads the bare word an older build left behind', () => {
    localStorage.setItem(KEY, 'close');
    expect(readAfterFinishChoice()).toBe('close');
  });

  it('round-trips a choice', () => {
    writeAfterFinishChoice('ask');
    expect(readAfterFinishChoice()).toBe('ask');
  });

  it('falls back when the stored value is not one of the three choices', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, value: 'explode' }));
    expect(readAfterFinishChoice()).toBe('stay');
  });
});
