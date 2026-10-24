import React from 'react';
import { HardDrive, FolderSync, Database, Cpu } from 'lucide-react';
import { Drive, DriveType } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { tGlobal } from '../i18n/translations';

interface DriveBarProps {
  theme: ThemeConfig;
  drives: Drive[];
  currentDriveId: string;
  onSelectDrive: (driveId: string) => void;
  panelSide: 'left' | 'right';
  isActive: boolean;
}

export const DriveBar: React.FC<DriveBarProps> = ({
  theme,
  drives,
  currentDriveId,
  onSelectDrive,
  panelSide,
  isActive
}) => {
  if (!drives.length) {
    return (
      <div className="px-[var(--space-2)] py-[var(--space-1)] text-[11px] opacity-70 border-t">
        {tGlobal('driveNoRealDrives')}
      </div>
    );
  }
  const currentDrive = drives.find(d => d.id === currentDriveId) || drives[0];

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    }
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${bytes} B`;
  };

  const getDriveIcon = (type: DriveType, selected: boolean) => {
    const tone = (color: string) => (selected ? 'text-black' : color);
    switch (type) {
      case 'ram':
        return <Cpu className={`w-3 h-3 ${tone('text-emerald-400')} inline mr-[var(--space-1)]`} />;
      case 'network':
        return <FolderSync className={`w-3 h-3 ${tone('text-purple-400')} inline mr-[var(--space-1)]`} />;
      case 'host_fs':
        return <Database className={`w-3 h-3 ${tone('text-amber-400')} inline mr-[var(--space-1)]`} />;
      default:
        return <HardDrive className={`w-3 h-3 ${tone('text-blue-300')} inline mr-[var(--space-1)]`} />;
    }
  };

  const usedPercent = currentDrive 
    ? Math.round(((currentDrive.totalBytes - currentDrive.freeBytes) / currentDrive.totalBytes) * 100) 
    : 50;

  return (
    <div 
      className="flex items-center justify-between px-[var(--space-2)] py-[var(--space-1)] text-xs border-b shrink-0 font-mono select-none"
      style={{
        backgroundColor: isActive ? theme.bgPanel : theme.bgPanelInactive,
        borderColor: theme.borderPanel,
        color: theme.itemText
      }}
    >
      {/* Drive Selector Buttons */}
      <div className="flex items-center gap-[var(--space-1)] overflow-x-auto no-scrollbar py-[var(--space-1)]">
        <span className="text-[11px] opacity-75 font-semibold mr-0.5">
          {panelSide === 'left' ? 'Alt+F1' : 'Alt+F2'}:
        </span>

        {drives.filter(d => d.isMounted).map((drive) => {
          const isSelected = drive.id === currentDriveId;
          return (
            <button
              key={drive.id}
              onClick={() => {
                soundManager.playDiskAccess();
                onSelectDrive(drive.id);
              }}
              title={`${drive.letter} ${drive.name}${drive.fileSystem ? ` [${drive.fileSystem}]` : ''}${drive.driveKind ? ` (${drive.driveKind})` : ''} - ${formatBytes(drive.freeBytes)} free`}
              className={`px-[var(--space-1)].5 py-[var(--space-1)] text-xs font-bold transition-all rounded flex items-center gap-[var(--space-1)] shrink-0 cursor-pointer ${
                isSelected
                  ? 'bg-amber-400 text-black shadow-inner font-extrabold ring-1 ring-amber-300'
                  : 'bg-black/30 hover:bg-black/50 text-white/90 border border-white/20'
              }`}
            >
              {getDriveIcon(drive.type, isSelected)}
              <span>[{drive.letter}]</span>
            </button>
          );
        })}
      </div>

      {/* Disk Space Meter */}
      {currentDrive && (
        <div className="hidden lg:flex items-center gap-[var(--space-2)] text-[11px] opacity-90 shrink-0 pl-2">
          <div className="w-16 h-2 bg-black/40 rounded-full overflow-hidden border border-white/20">
            <div 
              className={`h-full ${usedPercent > 85 ? 'bg-red-500' : usedPercent > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <span className="tabular-nums font-bold">
            {formatBytes(currentDrive.freeBytes)} <span className="opacity-60 text-[10px]">free</span>
          </span>
        </div>
      )}
    </div>
  );
};
