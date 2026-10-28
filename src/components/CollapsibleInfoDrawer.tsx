import React, { useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Cpu,
  HardDrive,
  ShieldCheck,
  Lock,
  Info,
  FileText,
  Server,
  TerminalSquare,
  Clock,
} from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { FileItem, Drive, LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';
import { useSystemStats } from '../hooks/useSystemStats';

interface CollapsibleInfoDrawerProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  activeDrive: Drive;
  activePath: string;
  focusedItem: FileItem | null;
  selectedCount: number;
  totalItemsCount: number;
  totalSelectedBytes: number;
  isAdminMode: boolean;
  onToggleAdminMode: () => void;
  onLockApp: () => void;
  isFolderProtected: boolean;
  onProtectFolder: () => void;
  showClock?: boolean;
  clockPosition?: 'header' | 'footer' | 'both';
}

export const CollapsibleInfoDrawer: React.FC<CollapsibleInfoDrawerProps> = ({
  theme,
  lang,
  activeDrive,
  activePath,
  focusedItem,
  selectedCount,
  totalItemsCount,
  totalSelectedBytes,
  isAdminMode,
  onToggleAdminMode,
  onLockApp,
  isFolderProtected,
  onProtectFolder,
  showClock = true,
  clockPosition = 'header',
}) => {
  const t = getTranslations(lang);
  const [isExpanded, setIsExpanded] = useState(false);
  const [timeStr, setTimeStr] = useState(() => new Date().toLocaleTimeString());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} B`;
  };

  const usedBytes = activeDrive.totalBytes - activeDrive.freeBytes;
  const usedPercent = Math.min(100, Math.round((usedBytes / activeDrive.totalBytes) * 100));

  // Real load of this machine, not the fixed figures that used to sit here. It
  // is only polled while the drawer is open, and a dash means the server has
  // not answered yet rather than "0% busy".
  const systemStats = useSystemStats(isExpanded);
  const cpuText =
    systemStats && systemStats.cpuPercent != null
      ? `${Math.round(systemStats.cpuPercent)}% (${systemStats.cores} ${t.coresLabel})`
      : '—';
  const ramText =
    systemStats && systemStats.ramTotalBytes > 0
      ? `${formatSize(systemStats.ramUsedBytes)} / ${formatSize(systemStats.ramTotalBytes)}`
      : '—';

  return (
    <div
      className="border-t shrink-0 font-mono text-xs select-none transition-all duration-200 z-20"
      style={{
        backgroundColor: theme.statusBg,
        borderColor: theme.borderPanel,
        color: theme.statusText,
      }}
    >
      {/* Drawer Header Toggle Bar */}
      <div
        className="px-[var(--space-2)] py-[var(--space-1)] flex items-center justify-between cursor-pointer bg-black/30 hover:bg-black/50 text-[11px]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-[var(--space-3)] truncate">
          <button
            className="flex items-center gap-[var(--space-1)] font-bold text-amber-400 hover:text-amber-300"
            title={t.collapseInfoPanel}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            <Info className="w-3.5 h-3.5" />
            <span>{t.infoPerformance}</span>
          </button>

          <span className="opacity-40">|</span>

          {/* Quick Drive Meter */}
          <div className="flex items-center gap-[var(--space-2)] text-[10px]">
            <HardDrive className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="font-bold">{activeDrive.letter}</span>
            <span className="opacity-80 font-mono">
              {formatSize(activeDrive.freeBytes)} {t.freeLabel} ({100 - usedPercent}%)
            </span>
            <div className="w-16 h-2 bg-black/60 rounded-full overflow-hidden border border-white/20">
              <div
                className={`h-full ${usedPercent > 85 ? 'bg-red-500' : 'bg-cyan-400'}`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
          </div>

          <span className="opacity-40">|</span>

          {/* Quick Selection Summary */}
          <span className="text-[10px] opacity-90 truncate">
            {selectedCount > 0 ? (
              <strong className="text-yellow-300">
                {selectedCount} {t.selectedShort} ({formatSize(totalSelectedBytes)})
              </strong>
            ) : (
              <span>
                {totalItemsCount} {t.itemsIn} {activePath}
              </span>
            )}
          </span>
        </div>

        {/* Right Badges */}
        <div className="flex items-center gap-[var(--space-2)] text-[10px]" onClick={(e) => e.stopPropagation()}>
          {/* Live Digital Clock (Footer position) */}
          {showClock && (clockPosition === 'footer' || clockPosition === 'both') && (
            <div className="flex items-center gap-[var(--space-1)] bg-black/60 border border-amber-400/50 text-amber-300 font-mono text-[10px] px-[var(--space-2)] py-[var(--space-1)] rounded font-bold">
              <Clock className="w-3 h-3 text-amber-400 animate-pulse" />
              <span>{timeStr}</span>
            </div>
          )}
          {/* Protected Folder Flag */}
          <button
            onClick={onProtectFolder}
            className={`px-[var(--space-2)] py-[var(--space-1)] rounded font-bold border flex items-center gap-[var(--space-1)] cursor-pointer transition-colors ${
              isFolderProtected
                ? 'bg-red-950/80 border-red-500 text-red-300 hover:bg-red-900'
                : 'bg-black/40 border-white/20 text-white/70 hover:bg-white/10'
            }`}
            title={isFolderProtected ? t.folderProtectedTitle : t.protectFolderWithPassTitle}
          >
            <Lock className="w-3 h-3" />
            {isFolderProtected ? t.protectedLabel : t.protectFolder}
          </button>

          {/* Admin Mode Toggle */}
          <button
            onClick={onToggleAdminMode}
            className={`px-[var(--space-2)] py-[var(--space-1)] rounded font-bold border flex items-center gap-[var(--space-1)] cursor-pointer transition-colors ${
              isAdminMode
                ? 'bg-amber-500/20 border-amber-400 text-amber-300 hover:bg-amber-500/30'
                : 'bg-black/40 border-white/20 text-white/60 hover:bg-white/10'
            }`}
            title={t.adminMode}
          >
            <TerminalSquare className="w-3 h-3" />
            {isAdminMode ? t.adminModeShort : t.userModeShort}
          </button>

          {/* App Lock Button */}
          <button
            onClick={onLockApp}
            className="px-[var(--space-2)] py-[var(--space-1)] bg-sky-950/80 border border-sky-400 text-sky-300 hover:bg-sky-900 rounded font-bold flex items-center gap-[var(--space-1)] cursor-pointer"
            title={t.lockAppWithPassword}
          >
            <ShieldCheck className="w-3 h-3" /> {t.lockApp}
          </button>
        </div>
      </div>

      {/* Expanded Detailed Grid */}
      {isExpanded && (
        <div className="p-[var(--space-3)] bg-black/60 border-t border-white/10 grid grid-cols-1 md:grid-cols-4 gap-[var(--space-3)] text-[11px] animate-in slide-in-from-bottom-2 duration-150">
          {/* Col 1: System Hardware Performance */}
          <div className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
            <h5 className="font-bold text-amber-300 uppercase tracking-wider text-[10px] flex items-center gap-[var(--space-1)]">
              <Cpu className="w-3.5 h-3.5" /> {t.systemPerformance}
            </h5>
            <div className="space-y-[var(--space-1)] text-[10px]">
              <div className="flex justify-between">
                <span className="opacity-70">{t.cpuLoad}</span>
                <span className="font-bold text-emerald-400 tabular-nums">{cpuText}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">{t.ramUsed}</span>
                <span className="font-bold text-cyan-400 tabular-nums">{ramText}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">{t.vfsEngine}</span>
                <span className="text-white">{t.vfsEngineActive}</span>
              </div>
            </div>
          </div>

          {/* Col 2: Storage Gauge */}
          <div className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
            <h5 className="font-bold text-cyan-300 uppercase tracking-wider text-[10px] flex items-center gap-[var(--space-1)]">
              <HardDrive className="w-3.5 h-3.5" /> {t.capacityOf} {activeDrive.letter}
            </h5>
            <div className="space-y-[var(--space-1)] text-[10px]">
              <div className="flex justify-between">
                <span className="opacity-70">{t.spaceTotal}</span>
                <span className="font-bold">{formatSize(activeDrive.totalBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">{t.spaceAvailable}</span>
                <span className="font-bold text-emerald-300">{formatSize(activeDrive.freeBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">{t.spaceUsed}</span>
                <span className="font-bold text-amber-300">
                  {formatSize(usedBytes)} ({usedPercent}%)
                </span>
              </div>
            </div>
          </div>

          {/* Col 3: Focused File / Folder Card */}
          <div className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
            <h5 className="font-bold text-emerald-300 uppercase tracking-wider text-[10px] flex items-center gap-[var(--space-1)]">
              <FileText className="w-3.5 h-3.5" /> {t.focusedElement}
            </h5>
            {focusedItem ? (
              <div className="space-y-[var(--space-1)] text-[10px] truncate">
                <div className="truncate font-bold text-white">
                  {focusedItem.name}
                  {focusedItem.ext ? `.${focusedItem.ext}` : ''}
                </div>
                <div className="flex justify-between opacity-80">
                  <span>
                    {t.typeLabel} {focusedItem.isDirectory ? t.folder : focusedItem.ext || t.file}
                  </span>
                  <span>{focusedItem.isDirectory ? '-' : formatSize(focusedItem.size)}</span>
                </div>
                <div className="opacity-60 text-[9px]">
                  {t.modifiedLabel} {focusedItem.modifiedAt}
                </div>
              </div>
            ) : (
              <span className="text-[10px] opacity-50 italic">{t.noItemFocused}</span>
            )}
          </div>

          {/* Col 4: Network & Security Status */}
          <div className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
            <h5 className="font-bold text-purple-300 uppercase tracking-wider text-[10px] flex items-center gap-[var(--space-1)]">
              <Server className="w-3.5 h-3.5" /> {t.networkSecurity}
            </h5>
            <div className="space-y-[var(--space-1)] text-[10px]">
              <div className="flex justify-between">
                <span className="opacity-70">{t.sharedNetworks}</span>
                <span className="text-emerald-400 font-bold">{t.smbOnline}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">{t.appEncryption}</span>
                <span className="text-sky-300 font-bold">{t.aesActive}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">{t.terminalMode}</span>
                <span className={`font-bold ${isAdminMode ? 'text-amber-400' : 'text-slate-300'}`}>
                  {isAdminMode ? t.adminElevated : t.normalUser}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
