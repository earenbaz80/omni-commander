import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Music, Film, X } from 'lucide-react';
import { FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { fsEngine } from '../services/fileSystem';
import { createSvgDataUrl } from '../utils/svgPreview';
import { formatBytes } from '../utils/formatBytes';
import { useFileContent } from '../hooks/useFileContent';
import { getTranslations } from '../i18n/translations';

interface QuickViewPaneProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  targetItem: FileItem | null;
  onClose: () => void;
}

const IMAGE_EXTENSIONS = ['PNG', 'JPG', 'JPEG', 'SVG', 'WEBP', 'GIF', 'BMP', 'ICO'];
const AUDIO_EXTENSIONS = ['MP3', 'WAV', 'OGG', 'MID', 'FLAC', 'AAC'];
const VIDEO_EXTENSIONS = ['MP4', 'WEBM', 'MKV', 'AVI', 'MOV'];

/** Playback needs the whole file in memory, so it stops here and says so. */
const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  MP3: 'audio/mpeg',
  WAV: 'audio/wav',
  OGG: 'audio/ogg',
  MID: 'audio/midi',
  FLAC: 'audio/flac',
  AAC: 'audio/aac',
  MP4: 'video/mp4',
  WEBM: 'video/webm',
  MKV: 'video/x-matroska',
  AVI: 'video/x-msvideo',
  MOV: 'video/quicktime',
};

/** `offset  hex bytes |ascii|`, from real bytes and nothing else. */
function hexDump(bytes: Uint8Array, limit = 512): string {
  const lines: string[] = [];
  const end = Math.min(bytes.length, limit);
  for (let offset = 0; offset < end; offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(offset + 16, end));
    const hex = Array.from(chunk)
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
      .padEnd(47, ' ');
    const ascii = Array.from(chunk)
      .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
      .join('');
    lines.push(`${offset.toString(16).padStart(8, '0').toUpperCase()}  ${hex} |${ascii}|`);
  }
  return lines.join('\n');
}

/**
 * Quick view of the focused file.
 *
 * It used to paint a hex dump invented from the file name (`name.ext_FILE_DATA`)
 * whenever the listing carried no bytes, which is always the case on a real
 * drive, and offered a media player with a fixed 180 s duration, a sine-wave
 * "visualizer" and a play button that only toggled a label. Both now read the
 * file: the text and hex tabs decode the real preview bytes, and the media tab
 * hands the real file to the browser's own player, which is the only thing that
 * can report a real duration.
 */
export const QuickViewPane: React.FC<QuickViewPaneProps> = ({ theme, lang, targetItem, onClose }) => {
  const t = getTranslations(lang);
  const [viewTab, setViewTab] = useState<'text' | 'hex' | 'info' | 'media'>('text');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const ext = targetItem?.ext?.toUpperCase() || '';
  const isImage = IMAGE_EXTENSIONS.includes(ext);
  const isAudio = AUDIO_EXTENSIONS.includes(ext);
  const isVideo = VIDEO_EXTENSIONS.includes(ext);
  const isMedia = isAudio || isVideo;

  // Preview bytes for the text and hex tabs. The hook caps the read, so a huge
  // file still opens instead of freezing the pane.
  const { state: contentState } = useFileContent(targetItem);
  const loadedBytes = contentState.status === 'ready' ? contentState.bytes : null;
  // `content` is an optional preload (archive entries carry it); the bytes from
  // disk win as soon as they arrive, and there is no invented fallback.
  const loadedText = contentState.status === 'ready' ? contentState.text : (targetItem?.content ?? '');

  useEffect(() => {
    setViewTab(isMedia ? 'media' : 'text');
    setMediaError(null);
    setMediaUrl(null);

    if (!targetItem || !isMedia || targetItem.isDirectory) return;
    if (targetItem.size > MEDIA_MAX_BYTES) {
      setMediaError(t.qvTooLarge.replace('{size}', formatBytes(MEDIA_MAX_BYTES)));
      return;
    }

    let cancelled = false;
    let url: string | null = null;
    fsEngine
      .readFileBytes(targetItem, { maxBytes: MEDIA_MAX_BYTES })
      .then((bytes) => {
        if (cancelled) return;
        // A plain ArrayBuffer of its own: `Uint8Array` may be backed by shared
        // memory, which a Blob cannot take.
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        url = URL.createObjectURL(new Blob([buffer], { type: MEDIA_TYPES[ext] || 'application/octet-stream' }));
        setMediaUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMediaError(t.qvMediaFailed);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // The read is driven by the file itself, not by the labels around it.
  }, [targetItem?.id, targetItem?.size, ext, isMedia, t.qvTooLarge, t.qvMediaFailed]);

  const hexText = useMemo(() => (loadedBytes ? hexDump(loadedBytes) : ''), [loadedBytes]);

  if (!targetItem) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center p-[var(--space-4)] text-center font-mono text-xs opacity-60"
        style={{ backgroundColor: theme.bgPanel, color: theme.itemText }}
      >
        <Eye className="w-8 h-8 mb-[var(--space-2)] opacity-40" />
        <span>{t.quickViewHint}</span>
      </div>
    );
  }

  const displayName =
    targetItem.fullName || (targetItem.ext ? `${targetItem.name}.${targetItem.ext}` : targetItem.name);

  // The pane replaces a panel's file list, so it carries stable hooks for the
  // end-to-end suite: one to tell it apart from the list, one to read which tab
  // the pane chose by itself.
  return (
    <div
      data-quick-view
      data-quick-view-tab={viewTab}
      className="flex-1 flex flex-col min-h-0 font-mono text-xs overflow-hidden border-l"
      style={{ backgroundColor: theme.bgPanel, borderColor: theme.borderPanel, color: theme.itemText }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-[var(--space-2)] py-[var(--space-1)] border-b font-bold text-xs shrink-0"
        style={{ backgroundColor: theme.headerBg, color: theme.headerText, borderColor: theme.borderPanel }}
      >
        <div className="flex items-center gap-[var(--space-1)] truncate">
          <Eye className="w-3.5 h-3.5" />
          <span className="truncate">{displayName}</span>
        </div>

        <div className="flex items-center gap-[var(--space-1)]">
          {isMedia && (
            <button
              onClick={() => setViewTab('media')}
              className={`px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[10px] cursor-pointer font-bold ${viewTab === 'media' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20 text-white'}`}
            >
              <Music className="w-3.5 h-3.5 inline mr-[var(--space-1)]" /> {t.qvPlay}
            </button>
          )}
          <button
            onClick={() => setViewTab('text')}
            className={`px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[10px] cursor-pointer ${viewTab === 'text' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20'}`}
          >
            {t.textLabel}
          </button>
          <button
            onClick={() => setViewTab('hex')}
            className={`px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[10px] cursor-pointer ${viewTab === 'hex' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20'}`}
          >
            Hex
          </button>
          <button
            onClick={() => setViewTab('info')}
            className={`px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[10px] cursor-pointer ${viewTab === 'info' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20'}`}
          >
            Info
          </button>
          <button
            onClick={onClose}
            aria-label={t.btnClose}
            className="px-[var(--space-1)].5 py-[var(--space-1)] hover:bg-black/30 text-white rounded text-[10px] cursor-pointer font-bold ml-[var(--space-1)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Preview Body */}
      <div className="flex-1 overflow-auto p-[var(--space-2)]">
        {viewTab === 'media' && (
          <div className="p-[var(--space-3)] bg-black/60 rounded border border-amber-400/40 mb-[var(--space-3)] space-y-[var(--space-2)] shadow-inner">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center gap-[var(--space-2)] truncate">
                {isAudio ? (
                  <Music className="w-5 h-5 text-amber-300 shrink-0" />
                ) : (
                  <Film className="w-5 h-5 text-cyan-300 shrink-0" />
                )}
                <p className="font-extrabold text-white text-xs truncate">{displayName}</p>
              </div>
              <span className="text-[10px] text-slate-300">{formatBytes(targetItem.size)}</span>
            </div>

            {mediaError ? (
              <p className="text-[11px] text-amber-300 leading-relaxed">{mediaError}</p>
            ) : mediaUrl ? (
              isAudio ? (
                <audio src={mediaUrl} controls className="w-full" />
              ) : (
                <video src={mediaUrl} controls className="w-full max-h-64 bg-black rounded" />
              )
            ) : (
              <p className="text-[11px] opacity-70">{t.qvLoading}</p>
            )}
          </div>
        )}

        {viewTab === 'text' && (
          <div>
            {isImage && ext === 'SVG' && loadedText ? (
              <div className="flex flex-col items-center justify-center p-[var(--space-4)] bg-black/20 rounded mb-[var(--space-2)]">
                <img
                  src={createSvgDataUrl(loadedText)}
                  alt={t.previewOf.replace('{name}', displayName)}
                  className="w-32 h-32 object-contain"
                />
              </div>
            ) : null}

            {contentState.status === 'error' ? (
              <p className="text-[11px] text-amber-300">{t.qvLoadFailed.replace('{error}', contentState.message)}</p>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text opacity-90">
                {loadedText || t.binaryNoPreview.replace('{n}', String(targetItem.size))}
              </pre>
            )}
          </div>
        )}

        {viewTab === 'hex' && (
          <div className="space-y-[var(--space-1)]">
            {contentState.status === 'error' ? (
              <p className="text-[11px] text-amber-300">{t.qvLoadFailed.replace('{error}', contentState.message)}</p>
            ) : hexText ? (
              <>
                <pre className="whitespace-pre font-mono text-[10px] select-text text-emerald-300 leading-tight">
                  {hexText}
                </pre>
                {contentState.status === 'ready' && contentState.truncated && (
                  <p className="text-[10px] text-amber-300">
                    {t.qvTruncated.replace('{size}', formatBytes(contentState.bytes.length))}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] opacity-70">{t.qvLoading}</p>
            )}
          </div>
        )}

        {viewTab === 'info' && (
          <div className="space-y-[var(--space-2)] select-text">
            <div className="p-[var(--space-2)] bg-black/30 rounded border border-white/10 space-y-[var(--space-1)]">
              <div>
                <span className="opacity-60">{t.pathLabel}</span> {targetItem.path}\{displayName}
              </div>
              <div>
                <span className="opacity-60">{t.sizeLabel}</span> {targetItem.size.toLocaleString()} bytes
              </div>
              <div>
                <span className="opacity-60">{t.modifiedLabel}</span> {targetItem.modifiedAt}
              </div>
              <div>
                <span className="opacity-60">{t.createdLabel}</span> {targetItem.createdAt}
              </div>
              <div>
                <span className="opacity-60">{t.attributesLabel}</span> {JSON.stringify(targetItem.attributes)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
