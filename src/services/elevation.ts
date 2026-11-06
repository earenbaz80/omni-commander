import type { getTranslations } from '../i18n/translations';
import type { ElevationResult } from '../types/electronBridge';

type Translations = ReturnType<typeof getTranslations>;

/**
 * The main process answers with a stable code and, when it exists, the raw
 * detail (an exit code or an OS message). Neither is shown as-is: the user
 * reads why the restart did not happen in their own language, and a refusal is
 * an answer rather than a defect.
 */
export function describeElevationFailure(result: ElevationResult | undefined, t: Translations): string {
  if (!result || result.ok) return '';
  if (result.reason === 'cancelled') return t.elevationCancelled;
  if (result.reason === 'unsupported') return t.elevationUnsupported;
  if (result.reason === 'elevate-missing') return t.elevationHelperMissing;
  const detail = result.detail || result.reason || 'unknown';
  return t.elevationFailed.replace('{reason}', detail);
}
