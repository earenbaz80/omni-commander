import React, { useState, useEffect } from 'react';
import { Eye, FileCode, Binary, Table, Image as ImageIcon, Music, Copy, Check, Save, Edit3 } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { fsEngine } from '../../services/fileSystem';
import { createSvgDataUrl } from '../../utils/svgPreview';

import { useModalDialog } from '../../hooks/useModalDialog';

interface ViewerModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onClose: () => void;
  onEdit: () => void;
  onSave?: () => void;
}

export const ViewerModal: React.FC<ViewerModalProps> = ({
  theme,
  lang,
  file,
  onClose,
  onEdit,
  onSave
}) => {
  const t = getTranslations(lang);
  const [activeTab, setActiveTab] = useState<'text' | 'hex' | 'csv' | 'preview'>('text');
  const [copied, setCopied] = useState(false);
  const [hexEditMode, setHexEditMode] = useState(false);
  const [byteBuffer, setByteBuffer] = useState<number[]>([]);
  const [selectedByteIndex, setSelectedByteIndex] = useState<number | null>(null);
  const [hexSavedNotice, setHexSavedNotice] = useState(false);

  if (!file) return null;

  const content = file.content || t.viewerBinaryNoData.replace('{size}', String(file.size));
  const ext = file.ext.toUpperCase();
  const isImage = ['PNG', 'JPG', 'JPEG', 'SVG', 'WEBP', 'GIF', 'BMP', 'ICO'].includes(ext);
  const isAudio = ['MP3', 'WAV', 'OGG', 'MID', 'FLAC'].includes(ext);
  const isCSV = ext === 'CSV';

  // Initialize byte buffer for hex editor
  useEffect(() => {
    const bytes: number[] = [];
    for (let i = 0; i < content.length; i++) {
      bytes.push(content.charCodeAt(i));
    }
    setByteBuffer(bytes);
  }, [content]);

  // Generate Hex dump
  const generateHexDump = () => {
    const lines = [];
    const maxLen = Math.min(byteBuffer.length, 2048);
    for (let i = 0; i < maxLen; i += 16) {
      const offset = i.toString(16).padStart(8, '0').toUpperCase();
      const chunk = byteBuffer.slice(i, i + 16);
      const hex = chunk
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ')
        .padEnd(48, ' ');
      const ascii = chunk
        .map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
        .join('');
      lines.push(`${offset}  ${hex} |${ascii}|`);
    }
    return lines.join('\n');
  };

  const handleByteEdit = (index: number, newHexVal: string) => {
    const parsed = parseInt(newHexVal, 16);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 255) {
      const updated = [...byteBuffer];
      updated[index] = parsed;
      setByteBuffer(updated);
    }
  };

  const handleSaveHexChanges = () => {
    const newContent = byteBuffer.map(b => String.fromCharCode(b)).join('');
    fsEngine.saveFileContent(file.id, newContent);
    soundManager.playSuccess();
    setHexSavedNotice(true);
    if (onSave) onSave();
    setTimeout(() => setHexSavedNotice(false), 2500);
  };

  // CSV table parser
  const renderCsvTable = () => {
    const rows = content.split('\n').filter(r => r.trim());
    if (rows.length === 0) return <div>{t.viewerCsvEmpty}</div>;
    const header = rows[0].split(',');
    const dataRows = rows.slice(1);

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse border border-white/20 text-xs">
          <thead>
            <tr className="bg-black/40">
              {header.map((h, idx) => (
                <th key={idx} className="border border-white/20 p-[var(--space-2)] font-bold text-amber-300">
                  {h.trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((r, rIdx) => {
              const cols = r.split(',');
              return (
                <tr key={rIdx} className="hover:bg-white/5">
                  {cols.map((col, cIdx) => (
                    <td key={cIdx} className="border border-white/10 p-[var(--space-2)] tabular-nums">
                      {col.trim()}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.viewerModalTitle);

  const handleCopyContent = () => {
    soundManager.playKeyTick();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-[var(--space-4)] font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        {/* Header bar */}
        <div 
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-[var(--space-2)] truncate">
            <Eye className="w-4 h-4" />
            <span className="truncate">{t.viewerLabel} {file.path}\{file.name}.{file.ext} ({file.size.toLocaleString()} bytes)</span>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <button
              onClick={onEdit}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer"
            >
              {t.edit}
            </button>
            <button
              onClick={onClose}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-black/20 hover:bg-red-500/80 rounded text-xs cursor-pointer font-bold"
            >
              ✕ Esc
            </button>
          </div>
        </div>

        {/* Mode switcher tabs */}
        <div className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-1)] bg-black/30 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-[var(--space-1)]">
            <button
              onClick={() => {
                soundManager.playKeyTick();
                setActiveTab('text');
              }}
              className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer ${
                activeTab === 'text' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" /> {t.viewerTextCode}
            </button>

            <button
              onClick={() => {
                soundManager.playKeyTick();
                setActiveTab('hex');
              }}
              className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer ${
                activeTab === 'hex' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
              }`}
            >
              <Binary className="w-3.5 h-3.5" /> {t.viewerHexadecimal}
            </button>

            {isCSV && (
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  setActiveTab('csv');
                }}
                className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer ${
                  activeTab === 'csv' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
                }`}
              >
                <Table className="w-3.5 h-3.5" /> {t.viewerCsvTable}
              </button>
            )}

            {(isImage || isAudio) && (
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  setActiveTab('preview');
                }}
                className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer ${
                  activeTab === 'preview' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
                }`}
              >
                {isImage ? <ImageIcon className="w-3.5 h-3.5" /> : <Music className="w-3.5 h-3.5" />} {t.viewerPreview}
              </button>
            )}
          </div>

          <button
            onClick={handleCopyContent}
            className="flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded text-xs cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? t.copiedLabel : t.copyBtn}</span>
          </button>
        </div>

        {/* Content Viewport */}
        <div className="flex-1 overflow-auto p-[var(--space-4)] bg-black/50 select-text">
          {activeTab === 'text' && (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-100">
              {content}
            </pre>
          )}

          {activeTab === 'hex' && (
            <div className="space-y-[var(--space-3)]">
              <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
                <div className="flex items-center gap-[var(--space-2)]">
                  <span className="font-bold text-emerald-400">{t.viewerHexEditorTitle}</span>
                  <span className="opacity-60 text-[10px]">({t.viewerBytesTotal.replace('{n}', String(byteBuffer.length))})</span>
                </div>

                <div className="flex items-center gap-[var(--space-2)]">
                  <button
                    onClick={() => {
                      setHexEditMode(!hexEditMode);
                      soundManager.playKeyTick();
                    }}
                    className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-[11px] font-bold flex items-center gap-[var(--space-1)] cursor-pointer ${
                      hexEditMode ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'
                    }`}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{hexEditMode ? t.viewerHexEditOn : t.viewerHexEditEnable}</span>
                  </button>

                  {hexEditMode && (
                    <button
                      onClick={handleSaveHexChanges}
                      className="px-[var(--space-3)] py-[var(--space-1)] bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[11px] flex items-center gap-[var(--space-1)] cursor-pointer"
                    >
                      <Save className="w-3 h-3" />
                      <span>{t.viewerSaveVfs}</span>
                    </button>
                  )}
                </div>
              </div>

              {hexSavedNotice && (
                <div className="p-[var(--space-2)] bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-[11px] rounded flex items-center gap-[var(--space-2)] animate-fadeIn">
                  <Check className="w-3.5 h-3.5" />
                  <span>{t.viewerHexSaved}</span>
                </div>
              )}

              {hexEditMode ? (
                <div className="p-[var(--space-2)] bg-black/60 rounded border border-white/15 space-y-[var(--space-2)]">
                  <div className="text-[10px] text-amber-300 opacity-90">
                    {t.viewerHexClickHint}
                  </div>
                  <div className="grid grid-cols-16 gap-[var(--space-1)] font-mono text-[11px]">
                    {byteBuffer.slice(0, 256).map((byte, idx) => {
                      const isSelected = selectedByteIndex === idx;
                      const hexStr = byte.toString(16).padStart(2, '0').toUpperCase();
                      const charStr = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';

                      return (
                        <div key={idx} className="flex flex-col items-center">
                          <input
                            type="text"
                            maxLength={2}
                            value={hexStr}
                            onChange={(e) => handleByteEdit(idx, e.target.value)}
                            onFocus={() => setSelectedByteIndex(idx)}
                            className={`w-7 text-center rounded px-0.5 py-[var(--space-1)] font-bold outline-none text-[11px] ${
                              isSelected
                                ? 'bg-amber-400 text-black'
                                : 'bg-white/5 text-emerald-400 hover:bg-white/10 border border-white/10'
                            }`}
                          />
                          <span className="text-[9px] text-neutral-400 select-none mt-0.5">{charStr}</span>
                        </div>
                      );
                    })}
                  </div>
                  {byteBuffer.length > 256 && (
                    <div className="text-[10px] opacity-60 italic text-center pt-1">
                      {t.viewerHexGridHint}
                    </div>
                  )}
                </div>
              ) : (
                <pre className="whitespace-pre font-mono text-[11px] leading-tight text-emerald-400 overflow-x-auto">
                  {generateHexDump()}
                </pre>
              )}
            </div>
          )}

          {activeTab === 'csv' && renderCsvTable()}

          {activeTab === 'preview' && (
            <div className="flex flex-col items-center justify-center p-8 space-y-[var(--space-4)]">
              {ext === 'SVG' && (
                <div className="w-48 h-48 border border-white/20 p-[var(--space-4)] rounded bg-white/5 flex items-center justify-center">
                  <img
                    src={createSvgDataUrl(content)}
                    alt={t.viewerPreviewAlt.replace('{name}', file.name).replace('{ext}', file.ext)}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              )}

              {isAudio && (
                <div className="text-center space-y-[var(--space-3)]">
                  <Music className="w-16 h-16 text-violet-400 mx-auto animate-pulse" />
                  <p className="font-bold text-base">{file.name}.{file.ext}</p>
                  <button
                    onClick={() => soundManager.playSuccess()}
                    className="px-[var(--space-4)] py-[var(--space-2)] bg-amber-400 text-black font-bold rounded hover:bg-amber-300 cursor-pointer shadow"
                  >
                    {t.viewerPlayTone}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <span className="opacity-75">{t.viewerLinesChars.replace('{n}', String(content.split('\n').length)).replace('{total}', String(content.length))}</span>
          <button
            onClick={onClose}
            className="px-[var(--space-4)] py-[var(--space-1)] bg-amber-400 hover:bg-amber-300 text-black font-bold rounded cursor-pointer"
          >
            {t.btnClose} (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
