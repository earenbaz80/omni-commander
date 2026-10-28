import React, { useState } from 'react';
import { Server, Terminal, HardDrive, ShieldCheck, RefreshCw } from 'lucide-react';
import { ThemeConfig } from '../../services/themeManager';
import { LanguageCode } from '../../types';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface FTPManagerModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onConnectDrive: (driveId: string) => void;
  onClose: () => void;
}

interface SavedFTPServer {
  id: string;
  name: string;
  protocol: 'FTP' | 'SFTP' | 'FTPS';
  host: string;
  port: number;
  user: string;
}

export const FTPManagerModal: React.FC<FTPManagerModalProps> = ({ theme, lang, onConnectDrive, onClose }) => {
  const t = getTranslations(lang);

  const [protocol, setProtocol] = useState<'FTP' | 'SFTP' | 'FTPS'>('SFTP');
  const [host, setHost] = useState('192.168.1.100');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('admin_ftp');
  const [password, setPassword] = useState('••••••••••••');
  const [remotePath, setRemotePath] = useState('/var/www/html/site');

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [logs, setLogs] = useState<string[]>([t.ftpLogBanner, t.ftpLogReady]);

  const savedServers: SavedFTPServer[] = [
    { id: 'srv_1', name: t.ftpPresetWeb, protocol: 'SFTP', host: '192.168.1.100', port: 22, user: 'webmaster' },
    { id: 'srv_2', name: t.ftpPresetNas, protocol: 'FTP', host: '192.168.1.250', port: 21, user: 'backup_user' },
    {
      id: 'srv_3',
      name: t.ftpPresetCloud,
      protocol: 'FTPS',
      host: 'ftp.companycloud.com',
      port: 990,
      user: 'deploy_agent',
    },
  ];

  const handleConnect = async () => {
    setIsConnecting(true);
    soundManager.playKeyTick();

    const newLogs = [
      t.ftpConnecting.replace('{protocol}', protocol).replace('{host}', host).replace('{port}', port),
      `[220] Welcome to OmniCommander Pro SFTP Subsystem 3.2`,
      `> USER ${username}`,
      `[331] Password required for ${username}`,
      `> PASS ********`,
      `[230] User ${username} logged in successfully. Operational mode ACTIVE.`,
      `> PWD`,
      `[257] "${remotePath}" is current directory.`,
      `> TYPE I (Binary Image Transfer)`,
      `[200] Type set to I.`,
      t.ftpLogSuccess,
    ];

    for (let i = 0; i < newLogs.length; i++) {
      await new Promise((r) => setTimeout(r, 120));
      setLogs((prev) => [...prev, newLogs[i]]);
    }

    setIsConnecting(false);
    setIsConnected(true);
    soundManager.playSuccess();
  };

  const handleOpenDrive = () => {
    soundManager.playDiskAccess();
    onConnectDrive('drive_ftp');
    onClose();
  };

  const handleSelectPreset = (srv: SavedFTPServer) => {
    soundManager.playKeyTick();
    setProtocol(srv.protocol);
    setHost(srv.host);
    setPort(srv.port.toString());
    setUsername(srv.user);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.ftpDialogLabel);

  return (
    <ModalShell title={t.ftpTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        {/* Content Body */}
        <div className="p-[var(--space-4)] space-y-[var(--space-4)] overflow-y-auto max-h-[75vh]">
          {/* Saved Servers Preset Buttons */}
          <div>
            <span className="text-[10px] uppercase font-bold text-amber-300 block mb-[var(--space-1)]">
              {t.ftpSaved}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[var(--space-2)]">
              {savedServers.map((srv) => (
                <button
                  key={srv.id}
                  onClick={() => handleSelectPreset(srv)}
                  className="p-[var(--space-2)] bg-black/40 hover:bg-white/10 rounded border border-white/10 text-left cursor-pointer transition-all"
                >
                  <p className="font-bold text-white text-[11px] truncate">{srv.name}</p>
                  <p className="text-[9px] opacity-60 font-mono">
                    {srv.protocol}://{srv.host}:{srv.port}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Configuration Form */}
          <div className="p-[var(--space-3)] bg-black/50 rounded border border-white/10 space-y-[var(--space-3)]">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-[var(--space-2)]">
              <div>
                <span className="text-[10px] opacity-70 block font-bold mb-[var(--space-1)]">{t.ftpProtocol}</span>
                <select
                  value={protocol}
                  onChange={(e) => {
                    const p = e.target.value as any;
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

          {/* Connection Output Log */}
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-[10px] font-bold text-emerald-400 uppercase flex items-center gap-[var(--space-1)]">
                <Terminal className="w-3 h-3" /> {t.ftpLogConsole}
              </span>
            </div>
            <div className="h-32 p-[var(--space-2)] bg-black/90 border border-emerald-500/30 rounded font-mono text-[10px] text-emerald-400 overflow-y-auto space-y-[var(--space-1)]">
              {logs.map((log, idx) => (
                <div key={idx} className="leading-tight truncate">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-[var(--space-4)] py-[var(--space-3)] border-t shrink-0 flex items-center justify-between"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder,
          }}
        >
          <div className="flex items-center gap-[var(--space-2)]">
            {isConnected ? (
              <span className="text-emerald-400 font-bold text-xs flex items-center gap-[var(--space-1)]">
                <ShieldCheck className="w-4 h-4" /> {t.ftpStatusConnected}
              </span>
            ) : isConnecting ? (
              <span className="text-amber-300 font-bold text-xs flex items-center gap-[var(--space-1)] animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin" /> {t.ftpStatusConnecting}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <button
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel}
            </button>

            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-5 py-[var(--space-2)] bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-2)]"
              >
                <Server className="w-4 h-4" /> {t.ftpBtnTestConnect}
              </button>
            ) : (
              <button
                onClick={handleOpenDrive}
                className="px-6 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-2)]"
              >
                <HardDrive className="w-4 h-4" /> {t.ftpBtnOpenDrive}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
