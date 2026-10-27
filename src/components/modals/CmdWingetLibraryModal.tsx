import React, { useState } from 'react';
import { Search, Copy, Check, Play, Sparkles } from 'lucide-react';
import { ThemeConfig } from '../../services/themeManager';
import { LanguageCode } from '../../types';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';
import ModalShell from '../ModalShell';

interface CmdWingetLibraryModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
  onRunInTerminal?: (cmd: string) => void;
}

interface CommandItem {
  id: string;
  name: string;
  category:
    'cmd_file' | 'cmd_system' | 'cmd_network' | 'cmd_disk' | 'winget_install' | 'winget_manage' | 'winget_config';
  categoryLabel: string;
  syntax: string;
  description: string;
  example: string;
  isWinget?: boolean;
}

const buildCommandDatabase = (t: Record<string, string>): CommandItem[] => [
  // Winget Commands
  {
    id: 'wg-search',
    name: 'winget search',
    category: 'winget_install',
    categoryLabel: t.wingetCatSearch,
    syntax: t.wingetSynSearch,
    description: t.wingetDescSearch,
    example: 'winget search vscode',
    isWinget: true,
  },
  {
    id: 'wg-install',
    name: 'winget install',
    category: 'winget_install',
    categoryLabel: t.wingetCatSearch,
    syntax: t.wingetSynInstall,
    description: t.wingetDescInstall,
    example: 'winget install --id Git.Git -e',
    isWinget: true,
  },
  {
    id: 'wg-upgrade-all',
    name: 'winget upgrade --all',
    category: 'winget_manage',
    categoryLabel: t.wingetCatManage,
    syntax: 'winget upgrade --all --include-unknown',
    description: t.wingetDescUpgradeAll,
    example: 'winget upgrade --all',
    isWinget: true,
  },
  {
    id: 'wg-list',
    name: 'winget list',
    category: 'winget_manage',
    categoryLabel: t.wingetCatManage,
    syntax: t.wingetSynList,
    description: t.wingetDescList,
    example: 'winget list chrome',
    isWinget: true,
  },
  {
    id: 'wg-uninstall',
    name: 'winget uninstall',
    category: 'winget_manage',
    categoryLabel: t.wingetCatManage,
    syntax: t.wingetSynUninstall,
    description: t.wingetDescUninstall,
    example: 'winget uninstall --id Notepad++.Notepad++',
    isWinget: true,
  },
  {
    id: 'wg-export',
    name: 'winget export',
    category: 'winget_config',
    categoryLabel: t.wingetCatAdvanced,
    syntax: t.wingetSynExport,
    description: t.wingetDescExport,
    example: t.wingetExExport,
    isWinget: true,
  },
  {
    id: 'wg-import',
    name: 'winget import',
    category: 'winget_config',
    categoryLabel: t.wingetCatAdvanced,
    syntax: t.wingetSynImport,
    description: t.wingetDescImport,
    example: t.wingetExImport,
    isWinget: true,
  },
  {
    id: 'wg-pin',
    name: 'winget pin',
    category: 'winget_config',
    categoryLabel: t.wingetCatAdvanced,
    syntax: t.wingetSynPin,
    description: t.wingetDescPin,
    example: 'winget pin add --id Python.Python.3.11',
    isWinget: true,
  },

  // CMD Files & Directories
  {
    id: 'cmd-dir',
    name: 'DIR',
    category: 'cmd_file',
    categoryLabel: t.wingetCatFiles,
    syntax: t.wingetSynDir,
    description: t.wingetDescDir,
    example: 'DIR /B /S *.txt',
  },
  {
    id: 'cmd-robocopy',
    name: 'ROBOCOPY',
    category: 'cmd_file',
    categoryLabel: t.wingetCatFiles,
    syntax: t.wingetSynRobocopy,
    description: t.wingetDescRobocopy,
    example: t.wingetExRobocopy,
  },
  {
    id: 'cmd-copy',
    name: 'COPY / XCOPY',
    category: 'cmd_file',
    categoryLabel: t.wingetCatFiles,
    syntax: t.wingetSynCopy,
    description: t.wingetDescCopy,
    example: 'COPY file.txt C:\\Backup\\',
  },
  {
    id: 'cmd-attrib',
    name: 'ATTRIB',
    category: 'cmd_file',
    categoryLabel: t.wingetCatFiles,
    syntax: t.wingetSynAttrib,
    description: t.wingetDescAttrib,
    example: t.wingetExAttrib,
  },
  {
    id: 'cmd-tree',
    name: 'TREE',
    category: 'cmd_file',
    categoryLabel: t.wingetCatFiles,
    syntax: t.wingetSynTree,
    description: t.wingetDescTree,
    example: t.wingetExTree,
  },
  {
    id: 'cmd-cipher',
    name: 'CIPHER',
    category: 'cmd_file',
    categoryLabel: t.wingetCatFiles,
    syntax: t.wingetSynCipher,
    description: t.wingetDescCipher,
    example: 'CIPHER /W:C:\\',
  },

  // CMD Network & Security
  {
    id: 'cmd-ipconfig',
    name: 'IPCONFIG',
    category: 'cmd_network',
    categoryLabel: t.wingetCatNetwork,
    syntax: 'IPCONFIG [/all] [/flushdns] [/release] [/renew]',
    description: t.wingetDescIpconfig,
    example: 'IPCONFIG /flushdns',
  },
  {
    id: 'cmd-ping',
    name: 'PING',
    category: 'cmd_network',
    categoryLabel: t.wingetCatNetwork,
    syntax: t.wingetSynPing,
    description: t.wingetDescPing,
    example: 'PING google.com -t',
  },
  {
    id: 'cmd-tracert',
    name: 'TRACERT',
    category: 'cmd_network',
    categoryLabel: t.wingetCatNetwork,
    syntax: t.wingetSynTracert,
    description: t.wingetDescTracert,
    example: 'TRACERT 8.8.8.8',
  },
  {
    id: 'cmd-netstat',
    name: 'NETSTAT',
    category: 'cmd_network',
    categoryLabel: t.wingetCatNetwork,
    syntax: 'NETSTAT -ano',
    description: t.wingetDescNetstat,
    example: 'NETSTAT -ano',
  },
  {
    id: 'cmd-nslookup',
    name: 'NSLOOKUP',
    category: 'cmd_network',
    categoryLabel: t.wingetCatNetwork,
    syntax: t.wingetSynNslookup,
    description: t.wingetDescNslookup,
    example: 'NSLOOKUP microsoft.com',
  },

  // CMD System & Disk
  {
    id: 'cmd-sfc',
    name: 'SFC /SCANNOW',
    category: 'cmd_system',
    categoryLabel: t.wingetCatSystem,
    syntax: 'SFC /SCANNOW',
    description: t.wingetDescSfc,
    example: 'SFC /SCANNOW',
  },
  {
    id: 'cmd-tasklist',
    name: 'TASKLIST / TASKKILL',
    category: 'cmd_system',
    categoryLabel: t.wingetCatSystem,
    syntax: 'TASKLIST | TASKKILL /PID <pid> /F /T',
    description: t.wingetDescTasklist,
    example: 'TASKKILL /IM chrome.exe /F',
  },
  {
    id: 'cmd-systeminfo',
    name: 'SYSTEMINFO',
    category: 'cmd_system',
    categoryLabel: t.wingetCatSystem,
    syntax: 'SYSTEMINFO [/FO {TABLE|LIST|CSV}]',
    description: t.wingetDescSysteminfo,
    example: 'SYSTEMINFO',
  },
  {
    id: 'cmd-chkdsk',
    name: 'CHKDSK',
    category: 'cmd_disk',
    categoryLabel: t.wingetCatDisk,
    syntax: t.wingetSynChkdsk,
    description: t.wingetDescChkdsk,
    example: 'CHKDSK C: /F /R',
  },
  {
    id: 'cmd-diskpart',
    name: 'DISKPART',
    category: 'cmd_disk',
    categoryLabel: t.wingetCatDisk,
    syntax: 'DISKPART',
    description: t.wingetDescDiskpart,
    example: 'DISKPART',
  },
];

export const CmdWingetLibraryModal: React.FC<CmdWingetLibraryModalProps> = ({
  theme,
  lang,
  onClose,
  onRunInTerminal,
}) => {
  const t = getTranslations(lang);
  const COMMAND_DATABASE = buildCommandDatabase(t);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const categories = [
    { id: 'all', label: t.wingetCatAll },
    { id: 'winget_install', label: t.wingetCatInstall },
    { id: 'winget_manage', label: t.wingetCatManage },
    { id: 'winget_config', label: t.wingetCatAdvanced },
    { id: 'cmd_file', label: t.wingetCatFiles },
    { id: 'cmd_network', label: t.wingetCatNetwork },
    { id: 'cmd_system', label: t.wingetCatSystem },
    { id: 'cmd_disk', label: t.wingetCatDisk },
  ];

  const filteredCommands = COMMAND_DATABASE.filter((cmd) => {
    const matchesCat = selectedCategory === 'all' || cmd.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      !q ||
      cmd.name.toLowerCase().includes(q) ||
      cmd.syntax.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.example.toLowerCase().includes(q);

    return matchesCat && matchesQuery;
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.wingetDialogLabel);

  return (
    <ModalShell title={t.cmdLibTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        {/* Filter Bar & Search */}
        <div
          className="p-[var(--space-3)] border-b flex flex-col sm:flex-row items-center gap-[var(--space-3)] bg-black/30"
          style={{ borderColor: theme.borderPanel }}
        >
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 opacity-50 text-amber-300" />
            <input
              type="text"
              placeholder={t.cmdLibSearch}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-[var(--space-2)] rounded bg-black/60 border border-white/20 text-amber-300 placeholder-white/40 focus:outline-none focus:border-amber-400 font-mono text-xs"
            />
          </div>

          <div className="flex items-center gap-[var(--space-1)] overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-[var(--space-3)] py-[var(--space-1)] rounded text-[11px] whitespace-nowrap cursor-pointer transition-colors font-medium border ${
                  selectedCategory === cat.id
                    ? 'bg-amber-400 text-black border-amber-300 font-bold'
                    : 'bg-black/40 border-white/10 hover:bg-white/10 text-white/80'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Command List Container */}
        <div className="flex-1 overflow-y-auto p-[var(--space-3)] space-y-[var(--space-3)] font-mono">
          {filteredCommands.length === 0 ? (
            <div className="text-center py-12 opacity-60">
              {t.wingetNoResults.replace('{query}', '"' + searchQuery + '"')}
            </div>
          ) : (
            filteredCommands.map((cmd) => (
              <div
                key={cmd.id}
                className="p-[var(--space-3)] rounded border bg-black/40 hover:bg-black/60 transition-all flex flex-col gap-[var(--space-2)] relative group"
                style={{ borderColor: theme.borderPanel }}
              >
                <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-b border-white/10 pb-2">
                  <div className="flex items-center gap-[var(--space-2)]">
                    <span className="font-bold text-amber-300 text-sm">{cmd.name}</span>
                    <span
                      className={`text-[10px] px-[var(--space-2)] py-[var(--space-1)] rounded font-sans border ${
                        cmd.isWinget
                          ? 'bg-blue-500/20 text-blue-300 border-blue-400/40'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                      }`}
                    >
                      {cmd.categoryLabel}
                    </span>
                  </div>

                  <div className="flex items-center gap-[var(--space-2)]">
                    {/* Copy Example */}
                    <button
                      onClick={() => handleCopy(cmd.id, cmd.example)}
                      className="px-[var(--space-2)] py-[var(--space-1)] rounded bg-white/10 hover:bg-white/20 text-white/90 flex items-center gap-[var(--space-1)] cursor-pointer transition-colors text-[11px]"
                      title={t.cmdLibCopyHint}
                    >
                      {copiedId === cmd.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400 font-bold">{t.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{t.copyBtn}</span>
                        </>
                      )}
                    </button>

                    {/* Run in Terminal */}
                    {onRunInTerminal && (
                      <button
                        onClick={() => {
                          onRunInTerminal(cmd.example);
                          onClose();
                        }}
                        className="px-[var(--space-3)] py-[var(--space-1)] rounded bg-amber-400 text-black hover:bg-amber-300 flex items-center gap-[var(--space-1)] cursor-pointer transition-colors font-bold text-[11px]"
                        title={t.wingetRunHint}
                      >
                        <Play className="w-3 h-3 fill-black" />
                        <span>{t.wingetRunBtn}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="text-white/80 font-sans text-xs leading-relaxed">{cmd.description}</p>

                {/* Syntax & Example */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-2)] text-[11px] pt-1">
                  <div className="bg-black/70 p-[var(--space-2)] rounded border border-white/10">
                    <span className="text-amber-400/80 block text-[10px] font-bold">{t.wingetSyntaxLabel}</span>
                    <code className="text-amber-200 select-all block mt-0.5 overflow-x-auto whitespace-pre">
                      {cmd.syntax}
                    </code>
                  </div>

                  <div className="bg-black/70 p-[var(--space-2)] rounded border border-amber-400/20">
                    <span className="text-emerald-400 block text-[10px] font-bold">{t.cmdLibExample}</span>
                    <code className="text-emerald-300 select-all block mt-0.5 overflow-x-auto whitespace-pre font-bold">
                      {cmd.example}
                    </code>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Info */}
        <div
          className="px-[var(--space-4)] py-[var(--space-2)] border-t flex flex-wrap items-center justify-between text-[11px] opacity-80"
          style={{ backgroundColor: theme.headerBg, borderColor: theme.borderPanel }}
        >
          <span className="flex items-center gap-[var(--space-1)]">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            {t.wingetFooterInfo}
          </span>
          <button
            onClick={onClose}
            className="px-[var(--space-4)] py-[var(--space-1)] bg-amber-400 text-black rounded font-bold hover:bg-amber-300 transition-colors cursor-pointer"
          >
            {t.wingetCloseLibrary}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
