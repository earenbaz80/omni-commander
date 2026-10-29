import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { ThemeConfig } from '../../services/themeManager';
import { LanguageCode } from '../../types';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface FTPManagerModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

/**
 * Remote-server settings, without the remote server.
 *
 * This modal used to fake a whole session: it printed an invented SSH handshake
 * ("[230] logged in successfully", "Remote FTP drive: mounted") one line every
 * 120 ms, switched to "Connected" without opening a socket, and then offered to
 * open `drive_ftp` -- an id no drive list has ever contained, so the button did
 * nothing at all. Showing a successful login that never happened is worse than
 * having no feature: the user goes looking for a remote drive that cannot exist.
 *
 * The product is loopback-only and ships no FTP/SFTP client, so the form stays
 * (the fields are what a future connector would need) and says plainly that it
 * contacts nothing. No connect button, no fabricated log, no drive to open.
 */
export const FTPManagerModal: React.FC<FTPManagerModalProps> = ({ theme, lang, onClose }) => {
  const t = getTranslations(lang);

  const [protocol, setProtocol] = useState<'FTP' | 'SFTP' | 'FTPS'>('SFTP');
  // Empty on purpose: prefilled addresses and passwords read as a saved profile.
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remotePath, setRemotePath] = useState('');

  const dialogRef = useModalDialog<HTMLDivElement>(t.ftpDialogLabel);

  return (
    <ModalShell title={t.ftpTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        {/* Content Body */}
        <div className="p-[var(--space-4)] space-y-[var(--space-4)] overflow-y-auto max-h-[75vh]">
          <div
            role="note"
            className="p-[var(--space-3)] bg-amber-400/10 border border-amber-400/40 rounded flex items-start gap-[var(--space-2)] text-[11px] leading-relaxed text-amber-200"
          >
            <Info className="w-4 h-4 shrink-0 mt-[1px]" aria-hidden="true" />
            <span>{t.ftpNoClient}</span>
          </div>

          {/* Configuration Form */}
          <div className="p-[var(--space-3)] bg-black/50 rounded border border-white/10 space-y-[var(--space-3)]">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-[var(--space-2)]">
              <div>
                <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpProtocol}</span>
                <select
                  value={protocol}
                  onChange={(e) => {
                    const p = e.target.value as 'FTP' | 'SFTP' | 'FTPS';
                    setProtocol(p);
                    if (p === 'SFTP') setPort('22');
                    else setPort('21');
                  }}
                  className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-bold"
                >
                  <option value="SFTP">{t.ftpOptSftp}</option>
                  <option value="FTP">{t.ftpOptFtp}</option>
                  <option value="FTPS">{t.ftpOptFtps}</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpHost}</span>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                  placeholder={t.ftpHostPlaceholder}
                />
              </div>

              <div>
                <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpPort}</span>
                <input
                  type="text"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-2)]">
              <div>
                <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpUser}</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
              </div>

              <div>
                <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpPass}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
              </div>
            </div>

            <div>
              <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpRemotePath}</span>
              <input
                type="text"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-cyan-300 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-[var(--space-4)] py-[var(--space-3)] border-t shrink-0 flex items-center justify-end"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder,
          }}
        >
          <button
            onClick={onClose}
            className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
          >
            {t.btnClose}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
