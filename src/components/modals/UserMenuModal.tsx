import React from 'react';
import { LanguageCode, ActiveModal } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import ModalShell from '../ModalShell';

interface UserMenuModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onOpenModal: (modal: ActiveModal) => void;
  onClose: () => void;
}

export const UserMenuModal: React.FC<UserMenuModalProps> = ({ theme, lang, onOpenModal, onClose }) => {
  const t = getTranslations(lang);

  // No casts: the union has one spelling per window, so an id the host does not
  // render fails to compile instead of closing this menu and opening nothing.
  const actions: Array<{ key: string; title: string; modal: ActiveModal }> = [
    { key: '1', title: t.userMenuBatchRename, modal: 'batch_rename' },
    { key: '2', title: t.userMenuDiff, modal: 'diff_compare' },
    { key: '3', title: t.userMenuGrep, modal: 'search_grep' },
    { key: '4', title: t.userMenuChecksum, modal: 'checksum' },
    { key: '5', title: t.userMenuZip, modal: 'zipArchive' },
    { key: '6', title: t.userMenuDiskUsage, modal: 'disk_usage' },
    { key: '9', title: t.userMenuSettings, modal: 'settings' },
  ];

  const handleSelect = (m: ActiveModal) => {
    soundManager.playKeyTick();
    onClose();
    onOpenModal(m);
  };

  return (
    <ModalShell title={t.userMenuTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        <div className="p-[var(--space-3)] space-y-[var(--space-2)]">
          {actions.map((act) => (
            <button
              key={act.key}
              onClick={() => handleSelect(act.modal)}
              className="w-full p-[var(--space-2)] rounded bg-black/30 hover:bg-white/15 border border-white/10 flex items-center gap-[var(--space-3)] cursor-pointer text-left transition-colors"
            >
              <span className="w-6 h-6 rounded bg-amber-400 text-black font-extrabold flex items-center justify-center shrink-0">
                {act.key}
              </span>
              <span className="font-semibold text-white truncate">{act.title}</span>
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
};
