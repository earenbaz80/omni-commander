import React, { useState } from 'react';
import { Scissors, Layers, FileText, CheckCircle2, HardDrive } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface FileSplitterJoinerModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  mode: 'split' | 'join';
  sourceFile: FileItem | null;
  targetDriveId: string;
  targetPath: string;
  onComplete: () => void;
  onClose: () => void;
}

export const FileSplitterJoinerModal: React.FC<FileSplitterJoinerModalProps> = ({
  theme,
  lang,
  mode: initialMode,
  sourceFile,
  targetDriveId,
  targetPath,
  onComplete,
  onClose
}) => {
  const t = getTranslations(lang);
  const [mode, setMode] = useState<'split' | 'join'>(initialMode);

  // Split settings
  const [chunkPreset, setChunkPreset] = useState<'100k' | '1m' | '10m' | '50m' | '100m' | 'custom'>('1m');
  const [customChunkKB, setCustomChunkKB] = useState(1024);

  const [isProcessing, setIsProcessing] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  const getChunkSizeBytes = (): number => {
    switch (chunkPreset) {
      case '100k': return 100 * 1024;
      case '1m': return 1024 * 1024;
      case '10m': return 10 * 1024 * 1024;
      case '50m': return 50 * 1024 * 1024;
      case '100m': return 100 * 1024 * 1024;
      case 'custom': return Math.max(1, customChunkKB) * 1024;
    }
  };

  const handleExecute = async () => {
    if (!sourceFile) {
      alert(t.splitterNoFile);
      return;
    }

    setIsProcessing(true);
    soundManager.playDiskAccess();

    try {
      if (mode === 'split') {
        const chunkSize = getChunkSizeBytes();
        const parts = fsEngine.splitFile(sourceFile.id, chunkSize, targetDriveId, targetPath);
        soundManager.playSuccess();
        setResultMsg(t.splitterSplitSuccess.replace('{n}', String(parts.length)));
      } else {
        const joined = fsEngine.joinFiles(sourceFile.id, targetDriveId, targetPath);
        soundManager.playSuccess();
        setResultMsg(
          t.splitterJoinSuccess
            .replace('{name}', joined.name)
            .replace('{ext}', joined.ext)
            .replace('{size}', String(joined.size))
        );
      }

      setTimeout(() => {
        onComplete();
        onClose();
      }, 1200);
    } catch (err: any) {
      alert(t.splitterError.replace('{error}', err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.splitterDialogTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg shadow-2xl border flex flex-col overflow-hidden text-xs"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="px-4 py-2.5 border-b font-bold shrink-0 flex items-center justify-between text-white"
          style={{ backgroundColor: theme.modalHeaderBg }}
        >
          <div className="flex items-center gap-2">
            {mode === 'split' ? (
              <Scissors className="w-5 h-5 text-amber-300" />
            ) : (
              <Layers className="w-5 h-5 text-emerald-300" />
            )}
            <span className="text-sm font-bold tracking-wide">
              {mode === 'split' ? t.splitterSplitTitle : t.splitterJoinTitle}
            </span>
          </div>
          <button 
            onClick={onClose} 
            className="px-2 py-0.5 bg-black/30 hover:bg-black/60 rounded text-xs cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>

        {/* Toggle Mode Bar */}
        <div className="p-3 bg-black/40 border-b border-white/10 flex items-center justify-center gap-2">
          <button
            onClick={() => setMode('split')}
            className={`px-4 py-1 rounded font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
              mode === 'split' ? 'bg-amber-400 text-black shadow' : 'bg-black/40 text-slate-300 border border-white/20'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" /> {t.splitterSplitTab}
          </button>

          <button
            onClick={() => setMode('join')}
            className={`px-4 py-1 rounded font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
              mode === 'join' ? 'bg-emerald-400 text-black shadow' : 'bg-black/40 text-slate-300 border border-white/20'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> {t.splitterJoinTab}
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 space-y-4">
          {/* File Selected */}
          <div className="p-2.5 bg-black/50 rounded border border-white/20 flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="truncate">
              <span className="text-[10px] opacity-60 block uppercase font-bold">{t.splitSelected}</span>
              <span className="font-extrabold text-white text-xs truncate block">
                {sourceFile ? `${sourceFile.name}.${sourceFile.ext} (${sourceFile.size} bytes)` : t.splitterNoneSelected}
              </span>
            </div>
          </div>

          {mode === 'split' && (
            <div className="space-y-2 p-3 bg-black/40 rounded border border-white/10">
              <span className="text-[10px] font-bold text-amber-300 uppercase block">{t.splitPartSize}</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: '100k', label: t.splitterSize100k },
                  { id: '1m', label: t.splitterSize1m },
                  { id: '10m', label: t.splitterSize10m },
                  { id: '50m', label: t.splitterSize50m },
                  { id: '100m', label: t.splitterSize100m },
                  { id: 'custom', label: t.splitterSizeCustom },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setChunkPreset(preset.id as any)}
                    className={`p-1.5 rounded border text-[10px] font-bold text-center cursor-pointer transition-all ${
                      chunkPreset === preset.id ? 'bg-amber-400 text-black border-amber-300' : 'bg-black/40 border-white/20 hover:bg-white/10'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {chunkPreset === 'custom' && (
                <div className="pt-2 flex items-center gap-2">
                  <span className="text-[11px] font-bold">{t.splitSizeKb}</span>
                  <input
                    type="number"
                    value={customChunkKB}
                    onChange={(e) => setCustomChunkKB(Number(e.target.value))}
                    className="w-32 px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {mode === 'join' && (
            <div className="p-3 bg-black/40 rounded border border-white/10 text-[11px] space-y-1">
              <p className="font-bold text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> {t.splitterAutoDetect}
              </p>
              <p className="opacity-80">
                {t.splitterAutoDetectDesc}
              </p>
            </div>
          )}

          {/* Destination Path */}
          <div className="p-2.5 bg-black/50 rounded border border-white/10 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="truncate">
              <span className="text-[10px] opacity-60 block uppercase font-bold">{t.splitDest}</span>
              <span className="font-bold text-white text-xs truncate block">{targetPath}</span>
            </div>
          </div>

          {resultMsg && (
            <div className="p-2.5 bg-emerald-950 border border-emerald-400 text-emerald-200 rounded font-bold text-center">
              {resultMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div 
          className="px-4 py-3 border-t shrink-0 flex items-center justify-end gap-2"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
          >
            {t.btnCancel}
          </button>

          <button
            onClick={handleExecute}
            disabled={isProcessing || !sourceFile}
            className="px-6 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-1.5"
          >
            {mode === 'split' ? (
              <>
                <Scissors className="w-4 h-4" /> {t.splitterSplitNow}
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" /> {t.splitterJoinNow}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
