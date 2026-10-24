import React, { useState, useEffect } from 'react';
import { ActiveModal, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';

interface FunctionKeyBarProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onOpenModal: (modal: ActiveModal) => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
  onMkDir: () => void;
  onView: () => void;
  onEdit: () => void;
}

export const FunctionKeyBar: React.FC<FunctionKeyBarProps> = ({
  theme,
  lang,
  onOpenModal,
  onCopy,
  onMove,
  onDelete,
  onMkDir,
  onView,
  onEdit
}) => {
  const [altPressed, setAltPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressed(true);
      if (e.key === 'Control') setCtrlPressed(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressed(false);
      if (e.key === 'Control') setCtrlPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

const t = getTranslations(lang);

  const getKeys = () => {
    if (altPressed) {
      return [
        { num: '1', label: 'Drive L', action: () => {} },
        { num: '2', label: 'Drive R', action: () => {} },
        { num: '3', label: 'HexView', action: onView },
        { num: '4', label: 'EditDOS', action: onEdit },
        { num: '5', label: 'ZipPack', action: () => onOpenModal('zipArchive') },
        { num: '6', label: 'Unzip', action: () => onOpenModal('zipArchive') },
        { num: '7', label: 'Find/Grep', action: () => onOpenModal('searchGrep') },
        { num: '8', label: 'History', action: () => {} },
        { num: '9', label: 'Video', action: () => {} },
        { num: '10', label: 'Exit', action: () => onOpenModal('quit') },
      ];
    }

    if (ctrlPressed) {
      return [
        { num: '1', label: 'Brief', action: () => {} },
        { num: '2', label: 'Full', action: () => {} },
        { num: '3', label: 'NameSort', action: () => {} },
        { num: '4', label: 'ExtSort', action: () => {} },
        { num: '5', label: 'TimeSort', action: () => {} },
        { num: '6', label: 'SizeSort', action: () => {} },
        { num: '7', label: 'Unsorted', action: () => {} },
        { num: '8', label: 'Filter', action: () => {} },
        { num: '9', label: 'Tree', action: () => {} },
        { num: '10', label: 'QuickView', action: () => {} },
      ];
    }

    return [
      { num: '1', label: t.helpF1, action: () => onOpenModal('help') },
      { num: '2', label: t.menuF2, action: () => onOpenModal('userMenu') },
      { num: '3', label: t.viewF3, action: onView },
      { num: '4', label: t.editF4, action: onEdit },
      { num: '5', label: t.copyF5, action: onCopy },
      { num: '6', label: t.moveF6, action: onMove },
      { num: '7', label: t.mkdirF7, action: onMkDir },
      { num: '8', label: t.deleteF8, action: onDelete },
      { num: '9', label: t.configF9, action: () => {} },
      { num: '10', label: t.quitF10, action: () => onOpenModal('quit') },
    ];
  };

  const keys = getKeys();

  return (
    <div 
      className="grid grid-cols-5 sm:grid-cols-10 gap-[var(--space-1)] p-[var(--space-1)] border-t shrink-0 select-none font-mono text-[11px] font-bold"
      style={{
        backgroundColor: theme.bgApp,
        borderColor: theme.borderPanel
      }}
    >
      {keys.map((k) => (
        <button
          key={k.num}
          onClick={() => {
            soundManager.playKeyTick();
            k.action();
          }}
          className="flex items-center justify-center overflow-hidden rounded-[2px] transition-transform active:scale-95 cursor-pointer shadow-sm"
        >
          {/* Key Number */}
          <span 
            className="px-[var(--space-2)] py-[var(--space-1)]"
            style={{ backgroundColor: theme.fkeyNumBg, color: theme.fkeyNumText }}
          >
            {k.num}
          </span>
          {/* Key Label */}
          <span 
            className="flex-1 py-[var(--space-1)] px-[var(--space-1)] truncate text-center"
            style={{ backgroundColor: theme.fkeyLabelBg, color: theme.fkeyLabelText }}
          >
            {k.label}
          </span>
        </button>
      ))}
    </div>
  );
};
