import { CleanupTargetId } from '../services/fileSystem';

/**
 * Menu and modal label for a cleanup target. The key has to be spelled out per
 * target because the translation tables are typed by literal key, which rules
 * out building the lookup from the id at runtime.
 */
export const cleanupTargetLabel = (id: CleanupTargetId, t: Record<string, string>): string => {
  if (id === 'windows-temp') return t.cleanupTargetWindowsTemp;
  if (id === 'prefetch') return t.cleanupTargetPrefetch;
  return t.cleanupTargetUserTemp;
};
