import { describe, expect, it } from 'vitest';
import { describeElevationFailure } from './elevation';
import { getTranslations } from '../i18n/translations';

const t = getTranslations('es');

describe('describeElevationFailure', () => {
  it('explains a refused consent prompt without calling it a failure', () => {
    expect(describeElevationFailure({ ok: false, reason: 'cancelled' }, t)).toBe(t.elevationCancelled);
  });

  it('names the helper missing from the build', () => {
    expect(describeElevationFailure({ ok: false, reason: 'elevate-missing' }, t)).toBe(t.elevationHelperMissing);
  });

  it('keeps the real exit code in the message', () => {
    const message = describeElevationFailure({ ok: false, reason: 'launch-failed', detail: 'elevate.exe exit 5' }, t);

    expect(message).toContain('elevate.exe exit 5');
    expect(message).toBe(t.elevationFailed.replace('{reason}', 'elevate.exe exit 5'));
  });

  it('says nothing when the restart was confirmed or never asked', () => {
    expect(describeElevationFailure({ ok: true }, t)).toBe('');
    expect(describeElevationFailure(undefined, t)).toBe('');
  });
});
