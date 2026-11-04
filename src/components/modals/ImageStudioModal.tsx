import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  FlipHorizontal,
  FlipVertical,
  Maximize,
  RotateCcw,
  RotateCw,
  Save,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { mediaUrlFor } from '../../services/mediaUrl';
import { fsEngine } from '../../services/fileSystem';
import { API_BASE } from '../../services/apiBase';

import ModalShell from '../ModalShell';

interface ImageStudioModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onSaved?: () => void;
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

/** Suffix stamped onto the copy so saving never overwrites the original. */
function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Image viewer and editor.
 *
 * The picture is fetched as bytes and shown from a blob URL instead of the
 * server URL directly: a canvas that drew a cross-origin image (the media route
 * lives on another port) is tainted, and `toBlob` would refuse to read it back.
 * Adjustments are applied on export from a separate render, so the toolbar never
 * accumulates resampling loss.
 */
export const ImageStudioModal: React.FC<ImageStudioModalProps> = ({ theme, lang, file, onSaved, onClose }) => {
  const t = getTranslations(lang);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The canvas keeps its own resolution; the on-screen size is a style, so the
  // element has to be re-styled after each draw or it renders 0x0.
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const sourceUrl = useMemo(() => mediaUrlFor(file), [file]);

  useEffect(() => {
    if (!sourceUrl) {
      setState('error');
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState('loading');
    setError(null);
    setSavedPath(null);
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setBrightness(100);
    setContrast(100);
    setSaturation(100);

    fetch(sourceUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise<void>((resolve, reject) => {
            objectUrl = URL.createObjectURL(blob);
            const picture = new Image();
            picture.onload = () => {
              if (cancelled) return resolve();
              setImage(picture);
              setState('ready');
              resolve();
            };
            picture.onerror = () => reject(new Error('decode-failed'));
            picture.src = objectUrl;
          }),
      )
      .catch(() => {
        if (!cancelled) {
          setState('error');
          setError(t.imageLoadError);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl, t.imageLoadError]);

  // Paint whenever the picture or an adjustment changes. The canvas keeps the
  // full resolution; the zoom is a CSS size, so exporting is never blurry.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) return;

    const quarterTurn = rotation % 180 !== 0;
    canvas.width = quarterTurn ? naturalHeight : naturalWidth;
    canvas.height = quarterTurn ? naturalWidth : naturalHeight;
    setCanvasSize((current) =>
      current.width === canvas.width && current.height === canvas.height
        ? current
        : { width: canvas.width, height: canvas.height },
    );

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    context.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    context.drawImage(image, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight);
    context.restore();
  }, [image, rotation, flipH, flipV, brightness, contrast, saturation]);

  const reset = () => {
    soundManager.playKeyTick();
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setZoom(1);
  };

  const saveCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !file) return;
    const source = fsEngine.absolutePathFor(file);
    if (!source) {
      setError(t.imageSaveError);
      return;
    }
    soundManager.playKeyTick();
    setSaving(true);
    setError(null);
    setSavedPath(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('encode-failed');
      const separator = source.includes('\\') ? '\\' : '/';
      const directory = source.slice(0, source.lastIndexOf(separator));
      const base = (file.name || 'imagen').replace(/[\\/:*?"<>|]/g, '_');
      const target = `${directory}${separator}${base}-editada-${stamp(new Date())}.png`;
      const token = window.electronAPI?.apiToken;
      const response = await fetch(
        `${API_BASE}/api/fs/write-bytes?path=${encodeURIComponent(target)}&root=${encodeURIComponent(directory)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(typeof token === 'string' && token ? { 'x-omni-token': token } : {}),
          },
          body: await blob.arrayBuffer(),
        },
      );
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || `HTTP ${response.status}`);
      }
      setSavedPath(target);
      onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? `${t.imageSaveError}: ${caught.message}` : t.imageSaveError);
    } finally {
      setSaving(false);
    }
  };

  if (!file) return null;

  const toolButton =
    'flex cursor-pointer items-center gap-[var(--space-1)] rounded border border-white/15 bg-white/5 px-[var(--space-2)] py-[var(--space-1)] text-xs hover:bg-white/15';
  const slider = 'w-full accent-amber-400';

  return (
    <ModalShell title={t.toolImageStudio} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div className="flex flex-col gap-[var(--space-3)] font-mono">
        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setZoom((z) => Math.min(8, z + 0.25));
            }}
            className={toolButton}
            title={t.imageZoomIn}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setZoom((z) => Math.max(0.1, z - 0.25));
            }}
            className={toolButton}
            title={t.imageZoomOut}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setZoom(1);
            }}
            className={toolButton}
            title={t.imageFit}
          >
            <Maximize className="h-3.5 w-3.5" />
            <span>{t.imageFit}</span>
          </button>
          <span className="mx-[var(--space-1)] h-4 w-px bg-white/20" />
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setRotation((value) => (value + 270) % 360);
            }}
            className={toolButton}
            title={t.imageRotateLeft}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setRotation((value) => (value + 90) % 360);
            }}
            className={toolButton}
            title={t.imageRotateRight}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setFlipH((value) => !value);
            }}
            className={toolButton}
            title={t.imageFlipH}
          >
            <FlipHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setFlipV((value) => !value);
            }}
            className={toolButton}
            title={t.imageFlipV}
          >
            <FlipVertical className="h-3.5 w-3.5" />
          </button>
          <button onClick={reset} className={toolButton} title={t.imageReset}>
            <span>{t.imageReset}</span>
          </button>
        </div>

        <div className="max-h-[45vh] min-h-40 overflow-auto rounded border border-white/15 bg-black/60 p-[var(--space-2)]">
          {state === 'loading' && <p className="p-[var(--space-2)] text-xs opacity-70">{t.loading}</p>}
          {state === 'error' && <p className="p-[var(--space-2)] text-xs text-red-400">{error || t.imageLoadError}</p>}
          <canvas
            ref={canvasRef}
            className="mx-auto block"
            style={{
              display: state === 'ready' ? 'block' : 'none',
              width: `${Math.round(canvasSize.width * zoom)}px`,
              height: `${Math.round(canvasSize.height * zoom)}px`,
              maxWidth: zoom === 1 ? '100%' : 'none',
              objectFit: 'contain',
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-[var(--space-2)] text-[11px] sm:grid-cols-3">
          <label className="flex flex-col gap-[var(--space-1)]">
            <span className="opacity-70">
              {t.imageBrightness}: {brightness}%
            </span>
            <input
              type="range"
              min={20}
              max={220}
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
              className={slider}
            />
          </label>
          <label className="flex flex-col gap-[var(--space-1)]">
            <span className="opacity-70">
              {t.imageContrast}: {contrast}%
            </span>
            <input
              type="range"
              min={20}
              max={220}
              value={contrast}
              onChange={(event) => setContrast(Number(event.target.value))}
              className={slider}
            />
          </label>
          <label className="flex flex-col gap-[var(--space-1)]">
            <span className="opacity-70">
              {t.imageSaturation}: {saturation}%
            </span>
            <input
              type="range"
              min={0}
              max={300}
              value={saturation}
              onChange={(event) => setSaturation(Number(event.target.value))}
              className={slider}
            />
          </label>
        </div>

        {error && state === 'ready' && <p className="text-xs text-red-400">{error}</p>}
        {savedPath && (
          <p className="flex items-center gap-[var(--space-1)] break-all text-xs text-emerald-300">
            <Check className="h-3.5 w-3.5 shrink-0" /> {t.imageSaved}: {savedPath}
          </p>
        )}

        <div className="flex items-center justify-between gap-[var(--space-2)] border-t border-white/10 pt-[var(--space-2)]">
          <span className="min-w-0 truncate text-xs opacity-60">
            {file.name}
            {file.ext ? `.${file.ext}` : ''}
            {image ? ` · ${image.naturalWidth}×${image.naturalHeight}` : ''}
          </span>
          <button
            onClick={saveCopy}
            disabled={state !== 'ready' || saving}
            className="flex cursor-pointer items-center gap-[var(--space-1)] rounded border border-amber-300 bg-amber-400 px-[var(--space-3)] py-[var(--space-1)] text-xs font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? t.loading : t.imageSaveAs}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
