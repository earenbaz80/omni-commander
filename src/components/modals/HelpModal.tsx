import React, { useState } from 'react';
import { Keyboard, Terminal, Layers, Cloud, Wrench, BookOpen, FolderSync, FileText, Search, GitCompare, Hash } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface HelpModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({
  theme,
  lang,
  onClose
}) => {
  const t = getTranslations(lang);
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'dual_panel' | 'commands' | 'cloud' | 'tools'>('shortcuts');

  const shortcutGroups = [
    {
      title: t.helpGroupFunctionKeys,
      shortcuts: [
        { key: 'F1', desc: t.helpScF1 },
        { key: 'F2', desc: t.helpScF2 },
        { key: 'F3', desc: t.helpScF3 },
        { key: 'F4', desc: t.helpScF4 },
        { key: 'F5', desc: t.helpScF5 },
        { key: 'F6', desc: t.helpScF6 },
        { key: 'F7', desc: t.helpScF7 },
        { key: 'F8 / Del', desc: t.helpScF8 },
        { key: 'F9', desc: t.helpScF9 },
        { key: 'F10', desc: t.helpScF10 },
      ]
    },
    {
      title: t.helpGroupNavigation,
      shortcuts: [
        { key: 'Tab', desc: t.helpScTab },
        { key: 'Enter', desc: t.helpScEnter },
        { key: 'Backspace / ..', desc: t.helpScBackspace },
        { key: 'Ctrl + T', desc: t.helpScCtrlT },
        { key: 'Ctrl + W', desc: t.helpScCtrlW },
        { key: 'Alt + F1', desc: t.helpScAltF1 },
        { key: 'Alt + F2', desc: t.helpScAltF2 },
        { key: 'Ctrl + R', desc: t.helpScCtrlR },
        { key: 'Ctrl + Q', desc: t.helpScCtrlQ },
      ]
    },
    {
      title: t.helpGroupSelection,
      shortcuts: [
        { key: t.helpKeySpaceInsert, desc: t.helpScSpaceInsert },
        { key: 'Ctrl + A', desc: t.helpScCtrlA },
        { key: '*', desc: t.helpScInvert },
        { key: 'Ctrl + F', desc: t.helpScCtrlF },
        { key: 'Alt + Enter', desc: t.helpScAltEnter },
        { key: 'Ctrl + D', desc: t.helpScCtrlD },
        { key: 'Ctrl + M', desc: t.helpScCtrlM },
        { key: 'Alt + F7', desc: t.helpScAltF7 },
        { key: 'Ctrl + H', desc: t.helpScCtrlH },
      ]
    }
  ];

  const dialogRef = useModalDialog<HTMLDivElement>(t.helpDialogLabel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-4xl h-[88vh] flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            <span>{t.helpManualTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-black/40 border-b border-white/10 shrink-0 overflow-x-auto no-scrollbar">
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('shortcuts');
            }}
            className={`px-3 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer font-semibold ${
              activeTab === 'shortcuts' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" /> {t.helpTabShortcuts}
          </button>

          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('dual_panel');
            }}
            className={`px-3 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer font-semibold ${
              activeTab === 'dual_panel' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> {t.helpTabDualPanel}
          </button>

          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('commands');
            }}
            className={`px-3 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer font-semibold ${
              activeTab === 'commands' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" /> {t.helpTabCommands}
          </button>

          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('cloud');
            }}
            className={`px-3 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer font-semibold ${
              activeTab === 'cloud' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" /> {t.helpTabCloud}
          </button>

          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('tools');
            }}
            className={`px-3 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer font-semibold ${
              activeTab === 'tools' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" /> {t.helpTabTools}
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
          {/* 1. Shortcuts Tab */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-4">
              {shortcutGroups.map((group, gIdx) => (
                <div key={gIdx} className="space-y-2">
                  <h3 className="font-bold text-amber-300 uppercase tracking-wider text-[11px] pb-1 border-b border-white/10">
                    {group.title}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.shortcuts.map((sc, sIdx) => (
                      <div key={sIdx} className="p-2 bg-black/30 rounded border border-white/10 flex items-start gap-2">
                        <span className="px-1.5 py-0.5 bg-black/60 border border-amber-400/40 text-amber-300 font-bold rounded text-[10px] shrink-0">
                          {sc.key}
                        </span>
                        <span className="opacity-90 text-[11px]">{sc.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 2. Dual Panel Tab */}
          {activeTab === 'dual_panel' && (
            <div className="space-y-3 leading-relaxed text-[11px]">
              <div className="p-3 bg-black/40 rounded border border-white/10 space-y-2">
                <h4 className="text-amber-300 font-bold text-xs uppercase">{t.helpDualPane}</h4>
                <p>
                  {t.helpDualPaneDesc}
                </p>
              </div>

              <div className="p-3 bg-black/40 rounded border border-white/10 space-y-2">
                <h4 className="text-cyan-300 font-bold text-xs uppercase">{t.helpTabs}</h4>
                <p>
                  {t.helpTabsDescPart1}<kbd className="px-1 py-0.5 bg-white/10 rounded">Ctrl + T</kbd>{t.helpTabsDescPart2}<kbd className="px-1 py-0.5 bg-white/10 rounded">Ctrl + W</kbd>{t.helpTabsDescPart3}
                </p>
              </div>

              <div className="p-3 bg-black/40 rounded border border-white/10 space-y-2">
                <h4 className="text-emerald-300 font-bold text-xs uppercase">{t.helpQuickView}</h4>
                <p>
                  {t.helpQuickViewDescPart1}<kbd className="px-1 py-0.5 bg-white/10 rounded">Ctrl + Q</kbd>{t.helpQuickViewDescPart2}
                </p>
              </div>
            </div>
          )}

          {/* 3. Commands Tab */}
          {activeTab === 'commands' && (
            <div className="space-y-3 leading-relaxed text-[11px]">
              <p className="opacity-90">
                {t.helpCommandsIntro}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { cmd: 'dir / ls', desc: t.helpCmdDirDesc },
                  { cmd: t.helpCmdCdPath, desc: t.helpCmdCdDesc },
                  { cmd: 'cd ..', desc: t.helpCmdCdUpDesc },
                  { cmd: t.helpCmdMkdirName, desc: t.helpCmdMkdirDesc },
                  { cmd: t.helpCmdDelFile, desc: t.helpCmdDelDesc },
                  { cmd: t.helpCmdTypeFile, desc: t.helpCmdTypeDesc },
                  { cmd: t.helpCmdEchoText, desc: t.helpCmdEchoDesc },
                  { cmd: 'tree', desc: t.helpCmdTreeDesc },
                  { cmd: 'cls / clear', desc: t.helpCmdClsDesc },
                  { cmd: 'ver', desc: t.helpCmdVerDesc },
                  { cmd: 'date / time', desc: t.helpCmdDateDesc },
                  { cmd: 'help', desc: t.helpCmdHelpDesc },
                ].map((c, idx) => (
                  <div key={idx} className="p-2 bg-black/40 rounded border border-white/10">
                    <span className="font-bold text-amber-300 block text-xs">{c.cmd}</span>
                    <span className="opacity-80 text-[11px]">{c.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Cloud & Host PC Tab */}
          {activeTab === 'cloud' && (
            <div className="space-y-3 leading-relaxed text-[11px]">
              <div className="p-3 bg-black/40 rounded border border-sky-500/30 space-y-2">
                <h4 className="text-sky-300 font-bold text-xs uppercase flex items-center gap-1.5">
                  <Cloud className="w-4 h-4" /> {t.helpCloudDrivesTitle}
                </h4>
                <p>
                  {t.helpCloudIntro}
                </p>
                <ul className="list-disc pl-5 space-y-1 opacity-90">
                  <li><strong>GD:</strong> {t.helpCloudGd}</li>
                  <li><strong>OD:</strong> {t.helpCloudOd}</li>
                  <li><strong>DB:</strong> {t.helpCloudDb}</li>
                  <li><strong>WD:</strong> {t.helpCloudWd}</li>
                </ul>
              </div>

              <div className="p-3 bg-black/40 rounded border border-emerald-500/30 space-y-2">
                <h4 className="text-emerald-300 font-bold text-xs uppercase flex items-center gap-1.5">
                  <FolderSync className="w-4 h-4" /> {t.helpMountTitle}
                </h4>
                <p>
                  {t.helpMountDescPart1}<em>File System Access</em>{t.helpMountDescPart2}<strong>{t.helpMountButton}</strong>{t.helpMountDescPart3}
                </p>
              </div>
            </div>
          )}

          {/* 5. Tools Tab */}
          {activeTab === 'tools' && (
            <div className="space-y-3 leading-relaxed text-[11px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-black/40 rounded border border-white/10 space-y-1">
                  <h4 className="font-bold text-amber-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> {t.helpToolRenameTitle}
                  </h4>
                  <p className="opacity-80">
                    {t.helpToolRenameDesc}
                  </p>
                </div>

                <div className="p-3 bg-black/40 rounded border border-white/10 space-y-1">
                  <h4 className="font-bold text-cyan-300 flex items-center gap-1.5">
                    <GitCompare className="w-3.5 h-3.5" /> {t.helpToolDiffTitle}
                  </h4>
                  <p className="opacity-80">
                    {t.helpToolDiffDesc}
                  </p>
                </div>

                <div className="p-3 bg-black/40 rounded border border-white/10 space-y-1">
                  <h4 className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5" /> {t.helpToolSearchTitle}
                  </h4>
                  <p className="opacity-80">
                    {t.helpToolSearchDesc}
                  </p>
                </div>

                <div className="p-3 bg-black/40 rounded border border-white/10 space-y-1">
                  <h4 className="font-bold text-fuchsia-300 flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5" /> {t.helpToolChecksumTitle}
                  </h4>
                  <p className="opacity-80">
                    {t.helpToolChecksumDesc}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <span className="opacity-70 text-[11px]">{t.helpFooter}</span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
          >
            {t.btnClose} (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
