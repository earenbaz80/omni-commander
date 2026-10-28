import React, { useState, useEffect } from 'react';
import { ActiveModal, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';
import { DiskTreeControls, useDiskTreeControls } from '../services/diskTreeControls';

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
  /**
   * True while the active panel shows the size tree instead of its files. The
   * keys that would act on the hidden list are then shown disabled, so the bar
   * stops being a mouse path around the keyboard block.
   */
  fileActionsDisabled?: boolean;
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
  onEdit,
  fileActionsDisabled = false,
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

  // `fileAction` marks the keys that read or change the file list of the active
  // panel; the rest (help, user menu, drive cycle, search, quit) are app-wide and
  // stay available whatever the panel is showing.
  type KeyEntry = {
    num: string;
    label: string;
    action: () => void;
    fileAction?: boolean;
    disabled?: boolean;
    /** Shown as engaged, e.g. while the tree follows the other panel. */
    pressed?: boolean;
  };

  // While the active panel shows the size tree, its own commands replace the
  // file keys: the list they used to act on is not on screen. The app-wide keys
  // keep their place at both ends.
  const diskTree = useDiskTreeControls();
  const treeMode = fileActionsDisabled ? diskTree : null;

  const getDiskTreeKeys = (controls: DiskTreeControls): KeyEntry[] => [
    { num: '1', label: t.helpF1, action: () => onOpenModal('help') },
    { num: '2', label: t.menuF2, action: () => onOpenModal('userMenu') },
    { num: '3', label: t.diskScanStop, action: controls.stop, disabled: !controls.scanning },
    { num: '4', label: t.diskKeyExpandAll, action: controls.expandAll, disabled: !controls.hasTree },
    { num: '5', label: t.diskKeyCollapseAll, action: controls.collapseAll, disabled: !controls.hasTree },
    { num: '6', label: t.diskPanePin, action: controls.pin },
    { num: '7', label: t.diskPaneFollow, action: controls.toggleFollow, pressed: controls.following },
    { num: '8', label: t.diskPaneClose, action: controls.close },
    { num: '9', label: t.configF9, action: () => {} },
    { num: '10', label: t.quitF10, action: () => onOpenModal('quit') },
  ];

  const getKeys = (): KeyEntry[] => {
    if (altPressed) {
      return [
        { num: '1', label: t.fkeyAltDriveL, action: () => {} },
        { num: '2', label: t.fkeyAltDriveR, action: () => {} },
        { num: '3', label: t.fkeyAltHexView, action: onView, fileAction: true },
        { num: '4', label: t.fkeyAltEditDos, action: onEdit, fileAction: true },
        { num: '5', label: t.fkeyAltZipPack, action: () => onOpenModal('zipArchive'), fileAction: true },
        { num: '6', label: t.fkeyAltUnzip, action: () => onOpenModal('zipArchive'), fileAction: true },
        { num: '7', label: t.fkeyAltFindGrep, action: () => onOpenModal('searchGrep') },
        { num: '8', label: t.fkeyAltHistory, action: () => {}, fileAction: true },
        { num: '9', label: t.fkeyAltVideo, action: () => {}, fileAction: true },
        { num: '10', label: t.fkeyAltExit, action: () => onOpenModal('quit') },
      ];
    }

    if (ctrlPressed) {
      // Everything here is a view, sort or filter change on the list itself.
      return [
        { num: '1', label: t.fkeyCtrlBrief, action: () => {}, fileAction: true },
        { num: '2', label: t.fkeyCtrlFull, action: () => {}, fileAction: true },
        { num: '3', label: t.fkeyCtrlSortName, action: () => {}, fileAction: true },
        { num: '4', label: t.fkeyCtrlSortExt, action: () => {}, fileAction: true },
        { num: '5', label: t.fkeyCtrlSortTime, action: () => {}, fileAction: true },
        { num: '6', label: t.fkeyCtrlSortSize, action: () => {}, fileAction: true },
        { num: '7', label: t.fkeyCtrlUnsorted, action: () => {}, fileAction: true },
        { num: '8', label: t.fkeyCtrlFilter, action: () => {}, fileAction: true },
        { num: '9', label: t.fkeyCtrlTree, action: () => {}, fileAction: true },
        { num: '10', label: t.fkeyCtrlQuickView, action: () => {}, fileAction: true },
      ];
    }

    return [
      { num: '1', label: t.helpF1, action: () => onOpenModal('help') },
      { num: '2', label: t.menuF2, action: () => onOpenModal('userMenu') },
      { num: '3', label: t.viewF3, action: onView, fileAction: true },
      { num: '4', label: t.editF4, action: onEdit, fileAction: true },
      { num: '5', label: t.copyF5, action: onCopy, fileAction: true },
      { num: '6', label: t.moveF6, action: onMove, fileAction: true },
      { num: '7', label: t.mkdirF7, action: onMkDir, fileAction: true },
      { num: '8', label: t.deleteF8, action: onDelete, fileAction: true },
      { num: '9', label: t.configF9, action: () => {} },
      { num: '10', label: t.quitF10, action: () => onOpenModal('quit') },
    ];
  };

  const keys = treeMode
    ? getDiskTreeKeys(treeMode)
    : getKeys().map((k) => ({ ...k, disabled: fileActionsDisabled && Boolean(k.fileAction) }));

  return (
    <div
      className="grid grid-cols-5 sm:grid-cols-10 gap-[var(--space-1)] p-[var(--space-1)] border-t shrink-0 select-none font-mono text-[11px] font-bold"
      style={{
        backgroundColor: theme.bgApp,
        borderColor: theme.borderPanel,
      }}
    >
      {keys.map((k) => (
        <button
          key={k.num}
          disabled={k.disabled}
          aria-disabled={k.disabled || undefined}
          aria-pressed={k.pressed}
          title={k.disabled && k.fileAction ? t.fileActionsPaused : undefined}
          onClick={() => {
            if (k.disabled) return;
            soundManager.playKeyTick();
            k.action();
          }}
          className={`flex items-center justify-center overflow-hidden rounded-[2px] shadow-sm ${
            k.disabled
              ? 'opacity-40 grayscale cursor-not-allowed'
              : 'transition-transform active:scale-95 cursor-pointer'
          } ${k.pressed ? 'ring-2 ring-amber-400' : ''}`}
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
