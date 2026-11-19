import type { PlatformCapabilities, PlatformId } from '../services/platform';
import { cleanupTargets, CleanupTargetId } from '../services/fileSystem';

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

/**
 * The cleanup folders this host can actually empty.
 *
 * The adapter says whether it implements cleanup at all, which is how a Linux
 * window stops offering a command the server would refuse. Of the folders, only
 * the user's temp one exists everywhere: the Windows temp folder and Prefetch
 * are named after a host this may not be, so they are offered on Windows only.
 */
export const cleanupTargetsFor = (capabilities: PlatformCapabilities, platform: PlatformId): typeof cleanupTargets => {
  if (!capabilities.cleanup) return [];
  return cleanupTargets.filter((entry) => entry.id === 'user-temp' || platform === 'win32');
};
