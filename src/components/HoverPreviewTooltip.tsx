import React, { useEffect, useState } from 'react';
import { FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { Image as ImageIcon, Calendar, HardDrive, Shield } from 'lucide-react';
import { createSvgDataUrl } from '../utils/svgPreview';
import { mediaUrlFor } from '../services/mediaUrl';
import { getTranslations } from '../i18n/translations';
import { formatBytesDetailed } from '../utils/formatBytes';

/**
 * The real picture when the local server can serve it, the old placeholder when
 * it cannot. The tooltip used to show that placeholder for every raster image,
 * so hovering a PNG never showed the PNG.
 */
const ThumbnailImage: React.FC<{ src: string | null; alt: string; placeholder: React.ReactNode }> = ({
  src,
  alt,
  placeholder,
}) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <>{placeholder}</>;
  return <img src={src} alt={alt} className="max-w-full max-h-full object-contain" onError={() => setBroken(true)} />;
};

interface HoverPreviewTooltipProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  item: FileItem | null;
  x: number;
  y: number;
  showThumbnail: boolean;
}

export const HoverPreviewTooltip: React.FC<HoverPreviewTooltipProps> = ({ theme, lang, item, x, y, showThumbnail }) => {
  const t = getTranslations(lang);

  if (!item) return null;

  const ext = item.ext.toUpperCase();
  const isImage = ['PNG', 'JPG', 'JPEG', 'SVG', 'WEBP', 'GIF', 'BMP', 'ICO'].includes(ext);

  const formatSize = (bytes: number): string => (item.isDirectory ? t.markerDirectory : formatBytesDetailed(bytes));

  // Adjust coordinates to avoid overflowing the viewport
  const tooltipWidth = isImage && showThumbnail ? 260 : 240;
  const tooltipHeight = isImage && showThumbnail ? 240 : 140;

  const adjustedX = x + tooltipWidth + 20 > window.innerWidth ? Math.max(10, x - tooltipWidth - 10) : x + 15;
  const adjustedY = y + tooltipHeight + 20 > window.innerHeight ? Math.max(10, y - tooltipHeight - 10) : y + 15;

  return (
    <div
      className="fixed z-50 pointer-events-none rounded shadow-2xl border text-xs font-mono select-none overflow-hidden transition-opacity duration-150 animate-in fade-in"
      style={{
        left: `${adjustedX}px`,
        top: `${adjustedY}px`,
        width: `${tooltipWidth}px`,
        backgroundColor: theme.modalBg,
        borderColor: theme.borderFocus,
        color: theme.itemText,
      }}
    >
      {/* Header bar */}
      <div
        className="px-[var(--space-3)] py-[var(--space-1)] border-b font-bold flex items-center justify-between truncate text-[11px]"
        style={{
          backgroundColor: theme.modalHeaderBg,
          color: theme.modalHeaderText,
        }}
      >
        <span className="truncate">
          {item.name}
          {item.ext ? `.${item.ext}` : ''}
        </span>
      </div>

      {/* Floating Image Thumbnail Preview if image and enabled */}
      {isImage && showThumbnail && (
        <div className="p-[var(--space-2)] bg-black/60 border-b border-white/10 flex flex-col items-center justify-center">
          {ext === 'SVG' && item.content ? (
            <div className="w-28 h-28 p-[var(--space-1)] rounded bg-black/40 border border-white/20 flex items-center justify-center overflow-hidden">
              <img
                src={createSvgDataUrl(item.content)}
                alt={t.commonPreviewOf.replace('{name}', item.name).replace('{ext}', item.ext)}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-28 h-28 rounded bg-black/40 border border-white/20 flex items-center justify-center overflow-hidden text-amber-300">
              <ThumbnailImage
                src={mediaUrlFor(item)}
                alt={t.commonPreviewOf.replace('{name}', item.name).replace('{ext}', item.ext)}
                placeholder={
                  <>
                    <ImageIcon className="w-10 h-10 mb-[var(--space-1)] opacity-70" />
                    <span className="text-[10px] font-bold uppercase">{t.hoverImageLabel.replace('{ext}', ext)}</span>
                  </>
                }
              />
            </div>
          )}
          <span className="text-[10px] opacity-75 mt-[var(--space-1)] font-semibold text-emerald-300">
            {t.hoverThumbnailPreview}
          </span>
        </div>
      )}

      {/* Text snippet preview for documents / text */}
      {!isImage && item.content && !item.isDirectory && (
        <div className="p-[var(--space-2)] bg-black/40 border-b border-white/10 text-[10px] text-slate-300 max-h-16 overflow-hidden leading-tight font-mono opacity-80">
          {item.content.slice(0, 100)}...
        </div>
      )}

      {/* Item Metadata Details */}
      <div className="p-[var(--space-2)] space-y-[var(--space-1)] text-[10px] bg-black/30">
        <div className="flex items-center justify-between">
          <span className="opacity-60 flex items-center gap-[var(--space-1)]">
            <HardDrive className="w-2.5 h-2.5" /> {t.sizeLabel}
          </span>
          <span className="font-bold text-white tabular-nums">{formatSize(item.size)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="opacity-60 flex items-center gap-[var(--space-1)]">
            <Calendar className="w-2.5 h-2.5" /> {t.modifiedLabel}
          </span>
          <span className="text-white tabular-nums">{item.modifiedAt.substring(0, 16)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="opacity-60 flex items-center gap-[var(--space-1)]">
            <Shield className="w-2.5 h-2.5" /> {t.attributesLabel}
          </span>
          <span className="text-amber-300 tracking-widest font-bold">
            {item.attributes.readOnly ? 'R' : '-'}
            {item.attributes.hidden ? 'H' : '-'}
            {item.attributes.archive ? 'A' : '-'}
            {item.attributes.system ? 'S' : '-'}
          </span>
        </div>
      </div>
    </div>
  );
};
