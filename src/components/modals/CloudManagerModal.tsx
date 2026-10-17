import React, { useState } from 'react';
import { Cloud, RefreshCw, Link2, FolderSync } from 'lucide-react';
import { Drive, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface CloudManagerModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  drives: Drive[];
  onMountDrive: (driveId: string, isMounted: boolean) => void;
  onMountLocalPC: () => void;
  onClose: () => void;
}

export const CloudManagerModal: React.FC<CloudManagerModalProps> = ({
  theme,
  lang,
  drives,
  onMountDrive,
  onMountLocalPC,
  onClose
}) => {
  const t = getTranslations(lang);
  const [syncingDriveId, setSyncingDriveId] = useState<string | null>(null);

  const handleSync = (driveId: string) => {
    soundManager.playDiskAccess();
    setSyncingDriveId(driveId);
    setTimeout(() => {
      setSyncingDriveId(null);
      soundManager.playSuccess();
    }, 1200);
  };

  const cloudDrives = drives.filter(d => ['cloud', 'network', 'host_fs'].includes(d.type));

  const dialogRef = useModalDialog<HTMLDivElement>(t.cloudServicesTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-sky-300" />
            <span>{t.cloudTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="opacity-90 text-[11px] leading-relaxed">
            {t.cloudIntro}
          </p>

          <div className="space-y-3">
            {cloudDrives.map((drive) => {
              const isSyncing = syncingDriveId === drive.id;

              return (
                <div 
                  key={drive.id}
                  className={`p-3 rounded border transition-all ${
                    drive.isMounted 
                      ? 'bg-black/40 border-sky-500/40' 
                      : 'bg-black/20 border-white/10 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded bg-sky-950/60 border border-sky-400/30 flex items-center justify-center">
                        <Cloud className="w-5 h-5 text-sky-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">[{drive.letter}] {drive.name}</span>
                          {drive.isMounted && (
                            <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/30">
                              {t.synced}
                            </span>
                          )}
                        </div>
                        <span className="opacity-60 text-[11px] block">{drive.description}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {drive.isMounted ? (
                        <>
                          <button
                            onClick={() => handleSync(drive.id)}
                            disabled={isSyncing}
                            className="px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-amber-400' : ''}`} />
                            <span>{isSyncing ? t.syncing : t.cloudSync}</span>
                          </button>
                          <button
                            onClick={() => {
                              soundManager.playKeyTick();
                              onMountDrive(drive.id, false);
                            }}
                            className="px-2.5 py-1 bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-500/30 rounded cursor-pointer"
                          >
                            {t.cloudDisconnect}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            soundManager.playSuccess();
                            onMountDrive(drive.id, true);
                          }}
                          className="px-3 py-1 bg-sky-500 hover:bg-sky-400 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-1"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>{t.cloudConnectDrive}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mount Local PC Drive Feature */}
          <div className="p-3.5 rounded bg-emerald-950/30 border border-emerald-500/40 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderSync className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-xs">{t.cloudMountLocal}</h4>
                  <p className="opacity-75 text-[11px]">
                    {t.cloudMountDesc}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  soundManager.playDiskAccess();
                  onMountLocalPC();
                }}
                className="px-4 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-black font-extrabold rounded cursor-pointer shadow shrink-0"
                >
                {t.cloudSelectPcFolder}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-end px-3 py-2 border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded cursor-pointer"
          >
            {t.btnClose}
          </button>
        </div>
      </div>
    </div>
  );
};
