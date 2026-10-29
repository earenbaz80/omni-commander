import { useCallback } from 'react';
import { FileItem, LanguageCode } from '../types';
import { fsEngine } from '../services/fileSystem';
import { getTranslations } from '../i18n/translations';

interface CommandExecutionDeps {
  lang: LanguageCode;
  activeItems: FileItem[];
  currentActiveTab: { currentPath: string; driveId: string };
  activePanel: 'left' | 'right';
  /** Real elevation state of the process, read from the server. */
  isAdminMode: boolean;
  handleGoParent: (side: 'left' | 'right') => void;
  handleNavigate: (side: 'left' | 'right', path: string) => void;
  setCommandHistory: React.Dispatch<React.SetStateAction<any[]>>;
}

/** Three levels of ASCII tree, then the indentation stops growing. */
const TREE_INDENT = '   ';

/**
 * Extracted command execution logic from App.tsx to reduce file size.
 * Handles MS-DOS style commands (help, dir, cd, mkdir, del, type, etc.).
 *
 * `ipconfig`, `tasklist` and `tree` used to print canned text from the
 * translation tables and `type` read a field the listing never fills, so the
 * shell answered with a machine that was not this one. Every branch now reads
 * what it reports and fails visibly when the read fails.
 */
export function useCommandExecution(deps: CommandExecutionDeps) {
  const {
    lang,
    activeItems,
    currentActiveTab,
    activePanel,
    isAdminMode,
    handleGoParent,
    handleNavigate,
    setCommandHistory,
  } = deps;
  const t = getTranslations(lang);

  const handleExecuteCommand = useCallback(
    async (cmd: string) => {
      const parts = cmd.trim().split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      if (!cmd.trim()) return;

      let output = '';
      let status: 'ok' | 'error' | 'info' = 'ok';

      /** Elevation is the one thing this shell cannot do to itself. */
      const requestElevation = async (): Promise<void> => {
        const bridge = (window as any).electronAPI;
        if (typeof bridge?.relaunchAsAdmin !== 'function') {
          output = t.cmdElevationUnavailable;
          status = 'error';
          return;
        }
        try {
          const result = await bridge.relaunchAsAdmin();
          output = result?.ok === false ? `${t.cmdElevationUnavailable} (${result.reason})` : t.cmdElevatedMsg;
          status = result?.ok === false ? 'error' : 'info';
        } catch (error: any) {
          output = error?.message || t.cmdElevationUnavailable;
          status = 'error';
        }
      };

      {
        switch (command) {
          case 'sudo':
          case 'runas':
          case 'admin':
            await requestElevation();
            break;
          case 'help':
            output = t.cmdAvailableCommands;
            break;
          case 'ver':
            output = `${t.cmdShellBanner} [v${__APP_VERSION__}]\n${isAdminMode ? t.cmdElevatedMode : t.cmdStandardMode}`;
            break;
          case 'ipconfig': {
            const adapters = await fsEngine.getNetworkAdapters();
            if (adapters.length === 0) {
              output = t.cmdNoAdapters;
              status = 'error';
              break;
            }
            output = adapters
              .map(
                (adapter) =>
                  `${adapter.name}${adapter.internal ? ' (loopback)' : ''}:\n` +
                  `  ${t.cmdIpv4}: ${adapter.address}\n` +
                  `  ${t.cmdNetmask}: ${adapter.netmask}`,
              )
              .join('\n\n');
            break;
          }
          case 'tasklist': {
            const processes = await fsEngine.getProcesses();
            if (processes.length === 0) {
              output = t.cmdNoProcesses;
              status = 'error';
              break;
            }
            const rows = processes.map(
              (process) => `${String(process.pid).padEnd(7)} ${process.name.padEnd(28)} ${process.memoryKb}`,
            );
            output = [`${t.cmdPid.padEnd(7)} ${t.cmdImage.padEnd(28)} ${t.cmdMem}`, ...rows].join('\n');
            break;
          }
          case 'dir':
          case 'ls':
            output = activeItems
              .map(
                (i) =>
                  `${i.modifiedAt}  ${i.isDirectory ? '<DIR>' : i.size.toString().padStart(10, ' ')}  ${i.name}${i.ext ? `.${i.ext}` : ''}`,
              )
              .join('\n');
            break;
          case 'cd':
            if (!args || args === '.') {
              output = currentActiveTab.currentPath;
            } else if (args === '..') {
              handleGoParent(activePanel);
              output = t.cmdCdUp;
            } else {
              const target = `${currentActiveTab.currentPath}\\${args}`;
              handleNavigate(activePanel, target);
              output = t.cmdCdTo.replace('{path}', target);
            }
            break;
          case 'mkdir':
          case 'md':
            if (!args) {
              output = t.cmdMkdirSyntax;
              status = 'error';
            } else {
              try {
                fsEngine.createDirectory(currentActiveTab.driveId, currentActiveTab.currentPath, args);
                output = t.cmdMkdirOk.replace('{path}', args);
              } catch (e: any) {
                output = e.message;
                status = 'error';
              }
            }
            break;
          case 'del':
          case 'rm': {
            const fileToDel = activeItems.find(
              (i) =>
                i.name.toLowerCase() === args.toLowerCase() ||
                `${i.name}.${i.ext}`.toLowerCase() === args.toLowerCase(),
            );
            if (fileToDel) {
              fsEngine.deleteItem(fileToDel.id);
              output = t.cmdFileDeleted.replace('{path}', args);
            } else {
              output = t.cmdFileNotFound.replace('{path}', args);
              status = 'error';
            }
            break;
          }
          case 'type':
          case 'cat': {
            const fileToRead = activeItems.find(
              (i) =>
                i.name.toLowerCase() === args.toLowerCase() ||
                `${i.name}.${i.ext}`.toLowerCase() === args.toLowerCase(),
            );
            if (!fileToRead || fileToRead.isDirectory) {
              output = t.cmdFileNotFound.replace('{path}', args);
              status = 'error';
              break;
            }
            try {
              // The listing carries no bytes, so the read has to come from disk;
              // a preview cap keeps a huge file from flooding the terminal.
              const bytes = await fsEngine.readFileBytes(fileToRead, { maxBytes: 64 * 1024 });
              output = new TextDecoder('utf-8').decode(bytes);
            } catch {
              output = t.cmdFileReadFail.replace('{path}', args);
              status = 'error';
            }
            break;
          }
          case 'echo':
            output = args;
            break;
          case 'cls':
          case 'clear':
            setCommandHistory([]);
            return;
          case 'calc':
            output = t.cmdCalcUnavailable;
            break;
          case 'date':
          case 'time':
            output = t.cmdDateNow.replace('{date}', new Date().toLocaleString());
            break;
          case 'tree': {
            const tree = await fsEngine.getFolderTree(currentActiveTab.driveId, currentActiveTab.currentPath);
            const lines = tree.entries.map((entry) => `${TREE_INDENT.repeat(entry.depth - 1)}${entry.name}`);
            output = [tree.path, ...lines, ...(tree.truncated ? [t.cmdTreeTruncated] : [])].join('\n');
            if (lines.length === 0 && !tree.truncated) output = `${tree.path}\n${t.cmdTreeEmpty}`;
            break;
          }
          default:
            output = t.cmdNotRecognized.replace('{cmd}', command);
            status = 'error';
            break;
        }
      }

      setCommandHistory((prev) => [
        ...prev,
        {
          id: `cmd_${Date.now()}`,
          timestamp: new Date().toTimeString().substring(0, 8),
          command: cmd,
          output,
          status,
        },
      ]);
    },
    [lang, activeItems, currentActiveTab, activePanel, isAdminMode, handleGoParent, handleNavigate, setCommandHistory],
  );

  return { handleExecuteCommand };
}
