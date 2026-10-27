import { useCallback } from 'react';
import { FileItem, LanguageCode } from '../types';
import { fsEngine } from '../services/fileSystem';
import { getTranslations } from '../i18n/translations';

interface CommandExecutionDeps {
  lang: LanguageCode;
  activeItems: FileItem[];
  currentActiveTab: { currentPath: string; driveId: string };
  activePanel: 'left' | 'right';
  isAdminMode: boolean;
  setIsAdminMode: (v: boolean) => void;
  handleGoParent: (side: 'left' | 'right') => void;
  handleNavigate: (side: 'left' | 'right', path: string) => void;
  setCommandHistory: React.Dispatch<React.SetStateAction<any[]>>;
}

/**
 * Extracted command execution logic from App.tsx to reduce file size.
 * Handles MS-DOS style commands (help, dir, cd, mkdir, del, type, etc.).
 */
export function useCommandExecution(deps: CommandExecutionDeps) {
  const {
    lang,
    activeItems,
    currentActiveTab,
    activePanel,
    isAdminMode,
    setIsAdminMode,
    handleGoParent,
    handleNavigate,
    setCommandHistory,
  } = deps;
  const t = getTranslations(lang);

  const handleExecuteCommand = useCallback(
    (cmd: string) => {
      const parts = cmd.trim().split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      let output = '';
      let status: 'ok' | 'error' | 'info' = 'ok';

      if (command === 'sudo' || command === 'runas' || command === 'admin') {
        setIsAdminMode(true);
        output = t.cmdElevatedMsg;
        status = 'info';
      } else {
        switch (command) {
          case 'help':
            output = t.cmdAvailableCommands;
            break;
          case 'ver':
            output = `${t.cmdShellBanner}\n${isAdminMode ? t.cmdElevatedMode : t.cmdStandardMode}`;
            break;
          case 'ipconfig':
            output = t.cmdIpconfigOut;
            break;
          case 'tasklist':
            output = t.cmdTasklistOut;
            break;
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
            if (fileToRead && fileToRead.content) {
              output = fileToRead.content;
            } else {
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
          case 'tree':
            output = `${currentActiveTab.currentPath}\n├── OMNICMD\n├── WINDOWS\n└── Users\n    └── Administrator`;
            break;
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
    [
      lang,
      activeItems,
      currentActiveTab,
      activePanel,
      isAdminMode,
      setIsAdminMode,
      handleGoParent,
      handleNavigate,
      setCommandHistory,
    ],
  );

  return { handleExecuteCommand };
}
