import React from 'react';
import { FolderTree, Pin, ArrowLeft, Radio } from 'lucide-react';
import { LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';
import { DiskUsageTree, DiskUsageTreeHandle, DiskUsageTreeStatus } from './DiskUsageTree';
import { setDiskTreeControls } from '../services/diskTreeControls';

interface DiskUsagePaneProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  /** The other panel's active tab: the folder the user is browsing right now. */
  followDriveId: string;
  followPath: string;
  onClose: () => void;
}

/**
 * TreeSize as a panel body, so a whole drive can be measured while the other
 * pane keeps browsing. Measuring is minutes of disk work, not an instant view,
 * so the folder is pinned by default: navigating elsewhere must not restart the
 * walk. Following the other panel is opt-in, and changing its folder cancels the
 * running scan and starts the new one.
 */
export const DiskUsagePane: React.FC<DiskUsagePaneProps> = ({ theme, lang, followDriveId, followPath, onClose }) => {
  const t = getTranslations(lang);
  // The folder is pinned to whatever the other panel showed when the view was
  // opened; "Pin this folder" re-pins it to where the user is browsing now.
  const [pinned, setPinned] = React.useState({ driveId: followDriveId, path: followPath });
  const [following, setFollowing] = React.useState(false);

  const target = following ? { driveId: followDriveId, path: followPath } : pinned;

  // Turning follow off keeps the folder being measured instead of jumping back
  // to the original pin: walking a drive is minutes of disk work, and throwing
  // it away to re-measure the old folder would be the worst of both.
  const toggleFollow = () => {
    soundManager.playKeyTick();
    if (following) setPinned({ driveId: followDriveId, path: followPath });
    setFollowing(!following);
  };

  const pinHere = () => {
    soundManager.playKeyTick();
    setPinned({ driveId: followDriveId, path: followPath });
    setFollowing(false);
  };

  // The function-key bar lives outside the panel, so the tree's own commands
  // (stop, expand all, collapse all) travel through this handle and the panel
  // publishes them in the shared store while it is on screen.
  const treeRef = React.useRef<DiskUsageTreeHandle | null>(null);
  const [treeStatus, setTreeStatus] = React.useState<DiskUsageTreeStatus>({ scanning: false, hasTree: false });
  const actionsRef = React.useRef({
    stop: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    pin: () => {},
    toggleFollow: () => {},
    close: () => {},
  });
  actionsRef.current = {
    stop: () => treeRef.current?.stop(),
    expandAll: () => treeRef.current?.expandAll(),
    collapseAll: () => treeRef.current?.collapseAll(),
    pin: pinHere,
    toggleFollow,
    close: onClose,
  };

  React.useEffect(() => {
    setDiskTreeControls({
      scanning: treeStatus.scanning,
      hasTree: treeStatus.hasTree,
      following,
      stop: () => actionsRef.current.stop(),
      expandAll: () => actionsRef.current.expandAll(),
      collapseAll: () => actionsRef.current.collapseAll(),
      pin: () => actionsRef.current.pin(),
      toggleFollow: () => actionsRef.current.toggleFollow(),
      close: () => actionsRef.current.close(),
    });
    return () => setDiskTreeControls(null);
  }, [treeStatus.scanning, treeStatus.hasTree, following]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center justify-between gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] border-b shrink-0 text-[11px]"
        style={{ backgroundColor: theme.headerBg, color: theme.headerText, borderColor: theme.borderPanel }}
      >
        <span className="flex items-center gap-[var(--space-1)] min-w-0 font-bold truncate">
          <FolderTree className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t.diskUsageTreeTitle}</span>
        </span>
        <div className="flex items-center gap-[var(--space-1)] shrink-0">
          <button
            type="button"
            onClick={toggleFollow}
            aria-pressed={following}
            title={t.diskPaneFollow}
            className={`px-1.5 py-[2px] rounded border flex items-center gap-[var(--space-1)] cursor-pointer ${
              following
                ? 'bg-amber-400 text-black border-amber-300 font-bold'
                : 'bg-black/30 border-white/30 hover:bg-black/50'
            }`}
          >
            <Radio className="w-3 h-3" />
            <span className="hidden lg:inline">{t.diskPaneFollow}</span>
          </button>
          <button
            type="button"
            onClick={pinHere}
            title={t.diskPanePin}
            className="px-1.5 py-[2px] rounded border bg-black/30 border-white/30 hover:bg-black/50 flex items-center gap-[var(--space-1)] cursor-pointer"
          >
            <Pin className="w-3 h-3" />
            <span className="hidden lg:inline">{t.diskPanePin}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t.diskPaneClose}
            className="px-1.5 py-[2px] rounded border bg-black/30 border-white/30 hover:bg-black/50 flex items-center gap-[var(--space-1)] cursor-pointer"
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="hidden lg:inline">{t.diskPaneClose}</span>
          </button>
        </div>
      </div>

      <div
        className="px-[var(--space-2)] py-[var(--space-1)] text-[10px] opacity-70 truncate shrink-0"
        title={target.path}
      >
        {target.path || '—'}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-[var(--space-1)] text-xs font-mono">
        <DiskUsageTree
          lang={lang}
          driveId={target.driveId}
          path={target.path}
          handleRef={treeRef}
          onStatusChange={setTreeStatus}
        />
      </div>
    </div>
  );
};
