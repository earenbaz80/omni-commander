import React, { useState, useEffect } from 'react';
import { Eye, Music, Film, Play, Pause, Volume2, VolumeX, Repeat, Cloud } from 'lucide-react';
import { FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { createSvgDataUrl } from '../utils/svgPreview';
import { getTranslations } from '../i18n/translations';

interface QuickViewPaneProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  targetItem: FileItem | null;
  onClose: () => void;
}

export const QuickViewPane: React.FC<QuickViewPaneProps> = ({
  theme,
  lang,
  targetItem,
  onClose
}) => {
  const t = getTranslations(lang);
  const [viewTab, setViewTab] = useState<'text' | 'hex' | 'info' | 'media'>('text');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration] = useState(180); // sample duration
  const [isLooping, setIsLooping] = useState(false);

  const ext = targetItem?.ext?.toUpperCase() || '';
  const isImage = ['PNG', 'JPG', 'JPEG', 'SVG', 'WEBP', 'GIF', 'BMP', 'ICO'].includes(ext);
  const isAudio = ['MP3', 'WAV', 'OGG', 'MID', 'FLAC', 'AAC'].includes(ext);
  const isVideo = ['MP4', 'WEBM', 'MKV', 'AVI', 'MOV'].includes(ext);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [targetItem]);

  if (!targetItem) {
    return (
      <div 
        className="flex-1 flex flex-col items-center justify-center p-4 text-center font-mono text-xs opacity-60"
        style={{ backgroundColor: theme.bgPanel, color: theme.itemText }}
      >
        <Eye className="w-8 h-8 mb-2 opacity-40" />
        <span>{t.quickViewHint}</span>
      </div>
    );
  }

  // Toggle play/pause simulation
  const togglePlay = () => {
    soundManager.playKeyTick();
    setIsPlaying(!isPlaying);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Generate Hex Dump representation
  const generateHexDump = (content: string) => {
    const lines = [];
    const maxLen = Math.min(content.length, 512);
    for (let i = 0; i < maxLen; i += 16) {
      const offset = i.toString(16).padStart(8, '0').toUpperCase();
      const chunk = content.slice(i, i + 16);
      const hex = Array.from(chunk)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
        .join(' ')
        .padEnd(48, ' ');
      const ascii = Array.from(chunk)
        .map(c => {
          const code = c.charCodeAt(0);
          return code >= 32 && code <= 126 ? c : '.';
        })
        .join('');
      lines.push(`${offset}  ${hex} |${ascii}|`);
    }
    return lines.join('\n');
  };

  return (
    <div 
      className="flex-1 flex flex-col min-h-0 font-mono text-xs overflow-hidden border-l"
      style={{ backgroundColor: theme.bgPanel, borderColor: theme.borderPanel, color: theme.itemText }}
    >
      {/* Header bar */}
      <div 
        className="flex items-center justify-between px-2 py-1 border-b font-bold text-xs shrink-0"
        style={{ backgroundColor: theme.headerBg, color: theme.headerText, borderColor: theme.borderPanel }}
      >
        <div className="flex items-center gap-1 truncate">
          <Eye className="w-3.5 h-3.5" />
          <span className="truncate">{targetItem.name}.{targetItem.ext}</span>
        </div>

        <div className="flex items-center gap-1">
          {(isAudio || isVideo) && (
            <button
              onClick={() => setViewTab('media')}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer font-bold ${viewTab === 'media' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20 text-white'}`}
            >
              <Music className="w-3.5 h-3.5 inline mr-1" /> Reproductor
            </button>
          )}
          <button
            onClick={() => setViewTab('text')}
            className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${viewTab === 'text' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20'}`}
          >
            Texto
          </button>
          <button
            onClick={() => setViewTab('hex')}
            className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${viewTab === 'hex' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20'}`}
          >
            Hex
          </button>
          <button
            onClick={() => setViewTab('info')}
            className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${viewTab === 'info' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-black/20'}`}
          >
            Info
          </button>
          <button
            onClick={onClose}
            className="px-1.5 py-0.5 hover:bg-black/30 text-white rounded text-[10px] cursor-pointer font-bold ml-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Preview Body */}
      <div className="flex-1 overflow-auto p-2">
        {/* Dedicated Audio & Video Mini Player */}
        {(isAudio || isVideo || viewTab === 'media') && (
          <div className="p-3 bg-black/60 rounded border border-amber-400/40 mb-3 space-y-3 shadow-inner">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center gap-2 truncate">
                {isAudio ? (
                  <Music className="w-5 h-5 text-amber-300 animate-pulse shrink-0" />
                ) : (
                  <Film className="w-5 h-5 text-cyan-300 shrink-0" />
                )}
                <div className="truncate">
                  <p className="font-extrabold text-white text-xs truncate">{targetItem.name}.{targetItem.ext}</p>
                  <p className="text-[10px] opacity-60 uppercase">{isAudio ? t.qvAudioTrack : t.qvVideoClip}</p>
                </div>
              </div>

              <span className="text-[10px] font-mono bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded font-bold border border-amber-400/30">
                {isPlaying ? t.qvPlaying : t.qvPaused}
              </span>
            </div>

            {/* Video Container Frame if Video */}
            {isVideo && (
              <div className="w-full h-36 bg-black rounded border border-white/20 flex items-center justify-center overflow-hidden relative">
                {targetItem.content?.startsWith('data:video') ? (
                  <video src={targetItem.content} controls className="w-full h-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-cyan-300">
                    <Film className="w-10 h-10 mb-1" />
                    <span className="text-[10px] opacity-80 font-bold">{t.simulatedVideo}</span>
                  </div>
                )}
              </div>
            )}

            {/* Simulated Audio Waveform Bar Visualizer */}
            {isAudio && (
              <div className="h-12 bg-black/80 rounded border border-white/10 flex items-end justify-between px-2 py-1 gap-1 overflow-hidden">
                {[...Array(28)].map((_, i) => {
                  const barHeight = isPlaying ? Math.floor(Math.sin(i + currentTime) * 40 + 50) : 20;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-gradient-to-t from-amber-500 to-yellow-300 rounded-t transition-all duration-150"
                      style={{ height: `${barHeight}%` }}
                    />
                  );
                })}
              </div>
            )}

            {/* Progress / Seek bar */}
            <div className="space-y-1">
              <input
                type="range"
                min="0"
                max={duration}
                value={currentTime}
                onChange={(e) => setCurrentTime(Number(e.target.value))}
                className="w-full accent-amber-400 h-1 bg-white/20 rounded cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] opacity-70 font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controls Bar */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded flex items-center gap-1 cursor-pointer shadow"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5 fill-black" /> : <Play className="w-3.5 h-3.5 fill-black" />}
                  <span>{isPlaying ? t.qvPause : t.qvPlay}</span>
                </button>

                <button
                  onClick={() => setIsLooping(!isLooping)}
                  className={`p-1.5 rounded border cursor-pointer ${isLooping ? 'bg-amber-400/30 text-amber-300 border-amber-400' : 'bg-black/30 border-white/20 text-slate-300'}`}
                  title={t.qvRepeatTrack}
                >
                  <Repeat className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded border border-white/10">
                <button onClick={() => setIsMuted(!isMuted)} className="hover:text-amber-300 cursor-pointer">
                  {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(Number(e.target.value));
                    if (isMuted) setIsMuted(false);
                  }}
                  className="w-16 h-1 accent-amber-400 bg-white/20 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {viewTab === 'text' && (
          <div>
            {isImage && targetItem.ext.toUpperCase() === 'SVG' && targetItem.content ? (
              <div className="flex flex-col items-center justify-center p-4 bg-black/20 rounded mb-2">
                <img
                  src={createSvgDataUrl(targetItem.content)}
                  alt={t.previewOf.replace('{name}', `${targetItem.name}.${targetItem.ext}`)}
                  className="w-32 h-32 object-contain"
                />
              </div>
            ) : null}

            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text opacity-90">
              {targetItem.content || t.binaryNoPreview.replace('{n}', String(targetItem.size))}
            </pre>
          </div>
        )}

        {viewTab === 'hex' && (
          <pre className="whitespace-pre font-mono text-[10px] select-text text-emerald-300 leading-tight">
            {generateHexDump(targetItem.content || `${targetItem.name}.${targetItem.ext}_FILE_DATA`)}
          </pre>
        )}

        {viewTab === 'info' && (
          <div className="space-y-2 select-text">
            <div className="p-2 bg-black/30 rounded border border-white/10 space-y-1">
              <div><span className="opacity-60">{t.pathLabel}</span> {targetItem.path}\{targetItem.name}.{targetItem.ext}</div>
              <div><span className="opacity-60">{t.sizeLabel}</span> {targetItem.size.toLocaleString()} bytes</div>
              <div><span className="opacity-60">{t.modifiedLabel}</span> {targetItem.modifiedAt}</div>
              <div><span className="opacity-60">{t.createdLabel}</span> {targetItem.createdAt}</div>
              <div><span className="opacity-60">{t.attributesLabel}</span> {JSON.stringify(targetItem.attributes)}</div>
              {targetItem.isCloud && (
                <div className="text-sky-300 font-bold flex items-center gap-1"><Cloud className="w-3 h-3" /> {t.propCloud} {targetItem.cloudProvider?.toUpperCase()} ({t.synced})</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

