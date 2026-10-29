import React, { useState } from 'react';
import { Keyboard, Terminal, Layers, Wrench, BookOpen, FileText, Search, GitCompare, Hash } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { RUN_EXAMPLE_ROWS } from '../../services/runLauncher';
import { buildShortcutGroups } from '../../services/shortcutGroups';

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

  // The same groups Settings > Shortcuts shows, from one shared list.
  const shortcutGroups = buildShortcutGroups(t);

  return (
    <ModalShell title={t.helpManualTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div className="font-mono select-none">
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
            <BookOpen className="w-3.5 h-3.5" /> {t.helpTabStorybook}
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

              <div className="space-y-[var(--space-2)]">
                <h3 className="font-bold text-amber-300 uppercase tracking-wider text-[11px] pb-1 border-b border-white/10">
                  {t.helpRunExamplesTitle}
                </h3>
                <p className="opacity-80 text-[var(--fs-sm)]">{t.helpRunExamplesIntro}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-2)]">
                  {' '}
                  {RUN_EXAMPLE_ROWS.map((row) => (
                    <div
                      key={row.descriptionKey}
                      className="p-[var(--space-2)] bg-black/30 rounded border border-white/10 space-y-[var(--space-1)]"
                    >
                      <code className="block font-bold text-amber-300 text-[var(--fs-sm)] break-all">
                        {row.examples.join(' · ')}
                      </code>
                      <span className="block opacity-90 text-[var(--fs-sm)]">{t[row.descriptionKey]}</span>
                    </div>
                  ))}
                </div>
              </div>
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
                <BookOpen className="w-5 h-5" /> {t.helpSbTitle}
              </h3>
              <p className="opacity-80">{t.helpSbIntro}</p>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-cyan-300">{t.helpSbRunTitle}</h4>
                <div className="font-mono text-[var(--fs-8)] bg-black/60 p-[var(--space-2)] rounded">
                  <div>npm run storybook</div>
                  <div className="opacity-60 mt-1"># → http://localhost:6006</div>
                </div>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-emerald-300">{t.helpSbStoriesTitle}</h4>
                <ul className="list-disc list-inside space-y-[var(--space-1)] opacity-80">
                  <li>
                    <strong>ModalShell</strong> — {t.helpSbStoryModalShell}
                  </li>
                  <li>
                    <strong>FunctionBar</strong> — {t.helpSbStoryFunctionBar}
                  </li>
                  <li>
                    <strong>KeybindingsTable</strong> — {t.helpSbStoryKeybindingsTable}
                  </li>
                  <li>
                    <strong>SettingsModal</strong> — {t.helpSbStorySettingsModal}
                  </li>
                  <li>
                    <strong>FileListStatusBar</strong> — {t.helpSbStoryFileListStatusBar}
                  </li>
                  <li>
                    <strong>FunctionKeyBar</strong> — {t.helpSbStoryFunctionKeyBar}
                  </li>
                  <li>
                    <strong>SectionCard</strong> — {t.helpSbStorySectionCard}
                  </li>
                  <li>
                    <strong>SettingsTabButton</strong> — {t.helpSbStorySettingsTabButton}
                  </li>
                  <li>
                    <strong>ThemePreview</strong> — {t.helpSbStoryThemePreview}
                  </li>
                </ul>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-fuchsia-300">{t.helpSbAddTitle}</h4>
                <ol className="list-decimal list-inside space-y-[var(--space-1)] opacity-80">
                  <li>
                    {t.helpSbAddStep1}{' '}
                    <code className="bg-black/60 px-1 rounded">src/stories/YourComponent.stories.tsx</code>
                  </li>
                  <li>
                    {t.helpSbAddStep2Before} <code className="bg-black/60 px-1 rounded">meta</code>{' '}
                    {t.helpSbAddStep2After}
                  </li>
                  <li>{t.helpSbAddStep3}</li>
                  <li>
                    {t.helpSbAddStep4Before} <code className="bg-black/60 px-1 rounded">npm run storybook</code>{' '}
                    {t.helpSbAddStep4After}
                  </li>
                </ol>
              </div>

              <div className="p-[var(--space-3)] bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                <h4 className="font-bold text-amber-300">{t.helpSbAddonsTitle}</h4>
                <ul className="list-disc list-inside space-y-[var(--space-1)] opacity-80">
                  <li>
                    <strong>Docs</strong> — {t.helpSbAddonDocs}
                  </li>
                  <li>
                    <strong>A11y</strong> — {t.helpSbAddonA11y}
                  </li>
                  <li>
                    <strong>Vitest</strong> — {t.helpSbAddonVitest}
                  </li>
                  <li>
                    <strong>Chromatic</strong> — {t.helpSbAddonChromatic}
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
