import React from 'react';
import { Sparkles } from 'lucide-react';
import { LanguageCode, ActiveModal } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface UserMenuModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onOpenModal: (modal: ActiveModal) => void;
  onClose: () => void;
}

export const UserMenuModal: React.FC<UserMenuModalProps> = ({
  theme,
  lang,
  onOpenModal,
  onClose
}) => {
  const t = getTranslations(lang);

  const actions = [
    { key: '1', title: t.userMenuBatchRename, modal: 'batchRename' as ActiveModal },
    { key: '2', title: t.userMenuDiff, modal: 'diffCompare' as ActiveModal },
    { key: '3', title: t.userMenuGrep, modal: 'searchGrep' as ActiveModal },
    { key: '4', title: t.userMenuChecksum, modal: 'checksum' as ActiveModal },
    { key: '5', title: t.userMenuZip, modal: 'zipArchive' as ActiveModal },
    { key: '6', title: t.userMenuDiskUsage, modal: 'diskUsage' as ActiveModal },
    { key: '7', title: t.userMenuCloud, modal: 'cloud_manager' as ActiveModal },
    { key: '8', title: t.userMenuMountLocal, modal: 'mountLocal' as ActiveModal },
    { key: '9', title: t.userMenuSettings, modal: 'settings' as ActiveModal },
  ];

  const handleSelect = (m: ActiveModal) => {
    soundManager.playKeyTick();
    onClose();
    onOpenModal(m);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.userMenuAriaLabel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            <span>{t.userMenuTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <div className="p-3 space-y-1.5">
          {actions.map((act) => (
            <button
              key={act.key}
              onClick={() => handleSelect(act.modal)}
              className="w-full p-2 rounded bg-black/30 hover:bg-white/15 border border-white/10 flex items-center gap-3 cursor-pointer text-left transition-colors"
            >
              <span className="w-6 h-6 rounded bg-amber-400 text-black font-extrabold flex items-center justify-center shrink-0">
                {act.key}
              </span>
              <span className="font-semibold text-white truncate">{act.title}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-end px-3 py-2 border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1 bg-white/10 hover:bg-white/20 rounded cursor-pointer"
          >
            {t.btnClose} (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
