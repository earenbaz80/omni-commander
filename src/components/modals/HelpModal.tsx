import React, { useState } from 'react';
import { Keyboard, Terminal, Layers, Wrench, BookOpen, FileText, Search, GitCompare, Hash } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface HelpModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ theme, lang, onClose }) => {
  const t = getTranslations(lang);
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'dual_panel' | 'commands' | 'tools' | 'storybook'>(
    'shortcuts',
  );

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
      ],
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
      ],
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
      ],
    },
  ];

  const dialogRef = useModalDialog<HTMLDivElement>(t.helpDialogLabel);

  return (
    <ModalShell title={t.helpManualTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        {/* Tab Navigation */}
        <div className="flex items-center gap-[var(--space-1)] px-[var(--space-3)] py-[var(--space-2)] bg-black/40 border-b border-white/10 shrink-0 overflow-x-auto no-scrollbar">
          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('shortcuts');
            }}
            className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-2)] cursor-pointer font-semibold ${
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
            className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-2)] cursor-pointer font-semibold ${
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
            className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-2)] cursor-pointer font-semibold ${
              activeTab === 'commands' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" /> {t.helpTabCommands}
          </button>

          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('tools');
            }}
            className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-2)] cursor-pointer font-semibold ${
              activeTab === 'tools' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" /> {t.helpTabTools}
          </button>

          <button
            onClick={() => {
              soundManager.playKeyTick();
              setActiveTab('storybook');
            }}
            className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-xs flex items-center gap-[var(--space-2)] cursor-pointer font-semibold ${
              activeTab === 'storybook' ? 'bg-amber-400 text-black shadow' : 'hover:bg-white/10 text-white/80'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" /> Storybook
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-[var(--space-4)] space-y-[var(--space-4)] select-text">
          {/* 1. Shortcuts Tab */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-[var(--space-4)]">
              {shortcutGroups.map((group, gIdx) => (
                <div key={gIdx} className="space-y-[var(--space-2)]">
                  <h3 className="font-bold text-amber-300 uppercase tracking-wider text-[11px] pb-1 border-b border-white/10">
                    {group.title}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-2)]">
                    {group.shortcuts.map((sc, sIdx) => (
                      <div
                        key={sIdx}
                        className="p-[var(--space-2)] bg-black/30 rounded border border-white/10 flex items-start gap-[var(--space-2)]"
                      >
                        <span className="px-[var(--space-1)].5 py-[var(--space-1)] bg-black/60 border border-amber-400/40 text-amber-300 font-bold rounded text-[var(--fs-8)] shrink-0">
                          {sc.key}
                        </span>
                        <span className="opacity-90 text-[var(--fs-sm)]">{sc.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 2. Dual Panel Tab */}
          {activeTab === 'dual_panel' && (
            <div className="space-y-[var(--space-3)] leading-relaxed text-[var(--fs-sm)]">
              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="text-amber-300 font-bold text-xs uppercase">{t.helpDualPane}</h4>
                <p>{t.helpDualPaneDesc}</p>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="text-cyan-300 font-bold text-xs uppercase">{t.helpTabs}</h4>
                <p>
                  {t.helpTabsDescPart1}
                  <kbd className="px-[var(--space-1)] py-[var(--space-1)] bg-white/10 rounded">Ctrl + T</kbd>
                  {t.helpTabsDescPart2}
                  <kbd className="px-[var(--space-1)] py-[var(--space-1)] bg-white/10 rounded">Ctrl + W</kbd>
                  {t.helpTabsDescPart3}
                </p>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="text-emerald-300 font-bold text-xs uppercase">{t.helpQuickView}</h4>
                <p>
                  {t.helpQuickViewDescPart1}
                  <kbd className="px-[var(--space-1)] py-[var(--space-1)] bg-white/10 rounded">Ctrl + Q</kbd>
                  {t.helpQuickViewDescPart2}
                </p>
              </div>
            </div>
          )}

          {/* 3. Commands Tab */}
          {activeTab === 'commands' && (
            <div className="space-y-[var(--space-3)] leading-relaxed text-[var(--fs-sm)]">
              <p className="opacity-90">{t.helpCommandsIntro}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-2)]">
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
                  <div key={idx} className="p-[var(--space-2)] bg-black/40 rounded border border-white/10">
                    <span className="font-bold text-amber-300 block text-xs">{c.cmd}</span>
                    <span className="opacity-80 text-[var(--fs-sm)]">{c.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Tools Tab */}
          {activeTab === 'tools' && (
            <div className="space-y-[var(--space-3)] leading-relaxed text-[var(--fs-sm)]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)]">
                <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-1)]">
                  <h4 className="font-bold text-amber-300 flex items-center gap-[var(--space-2)]">
                    <FileText className="w-3.5 h-3.5" /> {t.helpToolRenameTitle}
                  </h4>
                  <p className="opacity-80 text-[var(--fs-sm)]">{t.helpToolRenameDesc}</p>
                </div>

                <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-1)]">
                  <h4 className="font-bold text-cyan-300 flex items-center gap-[var(--space-2)]">
                    <GitCompare className="w-3.5 h-3.5" /> {t.helpToolDiffTitle}
                  </h4>
                  <p className="opacity-80 text-[var(--fs-sm)]">{t.helpToolDiffDesc}</p>
                </div>

                <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-1)]">
                  <h4 className="font-bold text-emerald-300 flex items-center gap-[var(--space-2)]">
                    <Search className="w-3.5 h-3.5" /> {t.helpToolSearchTitle}
                  </h4>
                  <p className="opacity-80 text-[var(--fs-sm)]">{t.helpToolSearchDesc}</p>
                </div>

                <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-1)]">
                  <h4 className="font-bold text-fuchsia-300 flex items-center gap-[var(--space-2)]">
                    <Hash className="w-3.5 h-3.5" /> {t.helpToolChecksumTitle}
                  </h4>
                  <p className="opacity-80 text-[var(--fs-sm)]">{t.helpToolChecksumDesc}</p>
                </div>
              </div>
            </div>
          )}

          {/* 5. Storybook Tab */}
          {activeTab === 'storybook' && (
            <div className="space-y-[var(--space-3)] leading-relaxed text-[var(--fs-sm)]">
              <h3 className="text-lg font-bold text-amber-300 flex items-center gap-[var(--space-2)]">
                <BookOpen className="w-5 h-5" /> Storybook — Component Catalog
              </h3>
              <p className="opacity-80">
                Storybook is an isolated development environment for UI components. It lets you view, test, and document
                each component independently without running the full app.
              </p>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-cyan-300">How to run Storybook</h4>
                <div className="font-mono text-[var(--fs-8)] bg-black/60 p-[var(--space-2)] rounded">
                  <div>npm run storybook</div>
                  <div className="opacity-60 mt-1"># → http://localhost:6006</div>
                </div>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-emerald-300">Available Stories</h4>
                <ul className="list-disc list-inside space-y-[var(--space-1)] opacity-80">
                  <li>
                    <strong>ModalShell</strong> — Unified modal backdrop, panel, header, and close button
                  </li>
                  <li>
                    <strong>FunctionBar</strong> — F1-F10 function bar with disabled/hidden states
                  </li>
                  <li>
                    <strong>KeybindingsTable</strong> — Searchable keybindings table with category/preset filters
                  </li>
                  <li>
                    <strong>SettingsModal</strong> — Full settings panel with vertical tabs
                  </li>
                  <li>
                    <strong>FileListStatusBar</strong> — File/dir/selection counts bar
                  </li>
                  <li>
                    <strong>FunctionKeyBar</strong> — Function key bar with Alt/Ctrl state
                  </li>
                  <li>
                    <strong>SectionCard</strong> — Reusable settings section card
                  </li>
                  <li>
                    <strong>SettingsTabButton</strong> — Active/inactive tab button
                  </li>
                  <li>
                    <strong>ThemePreview</strong> — Visual preview of theme colors
                  </li>
                </ul>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-fuchsia-300">How to add a new Story</h4>
                <ol className="list-decimal list-inside space-y-[var(--space-1)] opacity-80">
                  <li>
                    Create a file in{' '}
                    <code className="bg-black/60 px-1 rounded">src/stories/YourComponent.stories.tsx</code>
                  </li>
                  <li>
                    Import your component and create a <code className="bg-black/60 px-1 rounded">meta</code> object
                    with title, component, and args
                  </li>
                  <li>Export the meta as default and named exports for each story variant</li>
                  <li>
                    Run <code className="bg-black/60 px-1 rounded">npm run storybook</code> to see it live
                  </li>
                </ol>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-amber-300">Storybook Addons</h4>
                <ul className="list-disc list-inside space-y-[var(--space-1)] opacity-80">
                  <li>
                    <strong>Docs</strong> — Auto-generated documentation from props and JSDoc
                  </li>
                  <li>
                    <strong>A11y</strong> — Accessibility checks (contrast, ARIA, keyboard nav)
                  </li>
                  <li>
                    <strong>Vitest</strong> — Run component tests inside Storybook
                  </li>
                  <li>
                    <strong>Chromatic</strong> — Visual regression testing in CI
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder,
          }}
        >
          <span className="opacity-70 text-[var(--fs-sm)]">{t.helpFooter}</span>
          <button
            onClick={onClose}
            className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
          >
            {t.btnClose} (Esc)
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
