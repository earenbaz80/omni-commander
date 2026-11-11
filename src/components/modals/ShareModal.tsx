import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Share2 } from 'lucide-react';
import { LanguageCode, ShareStatus } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { API_BASE } from '../../services/apiBase';
import { fetchWithRetry } from '../../utils/fetchWithRetry';
import ModalShell from '../ModalShell';

interface ShareModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  /** Folder the active panel is showing, as the suggestion to share. */
  startFolder?: string;
  onClose: () => void;
}

const EMPTY_STATUS: ShareStatus = {
  active: false,
  folder: null,
  port: null,
  token: null,
  startedAt: null,
  urls: [],
};

/**
 * Sharing a folder with another computer on the same network.
 *
 * The server owns the listener and the token; this dialog only asks it to start
 * or stop and shows the links it gets back. That is why the folder field is
 * filled from the answer rather than remembered here: a reload of the app has to
 * show what is actually running, not what was last typed.
 */
export const ShareModal: React.FC<ShareModalProps> = ({ theme, lang, startFolder, onClose }) => {
  const t = getTranslations(lang);
  const [status, setStatus] = useState<ShareStatus>(EMPTY_STATUS);
  const [folder, setFolder] = useState(startFolder ?? '');
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/share`);
      if (!response.ok) return;
      const next = (await response.json()) as ShareStatus;
      setStatus(next);
      if (next.folder) setFolder(next.folder);
      if (next.port) setPort(String(next.port));
    } catch {
      // Nothing to say here: the panel still offers to start a share, and that
      // request is where a dead server becomes visible.
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const choose = async () => {
    const picker = window.electronAPI?.pickPaths;
    if (!picker) {
      setError(t.sharePickerUnavailable);
      return;
    }
    const picks = await picker('folders', t.shareChooseTitle);
    if (picks.length > 0) {
      setFolder(String(picks[0]));
      setError('');
    }
  };

  const start = async () => {
    if (!folder.trim()) {
      setError(t.shareNoFolder);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/share/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: folder.trim(),
          port: port.trim() === '' ? undefined : Number(port),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ShareStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || t.shareFailed);
      setStatus(body);
      if (body.port) setPort(String(body.port));
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t.shareFailed);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/share/stop`, { method: 'POST' });
      if (response.ok) setStatus((await response.json()) as ShareStatus);
    } catch {
      setError(t.shareFailed);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      // Clipboard permission can be refused; the link is still on screen to be
      // selected by hand, so this is not worth an error message of its own.
      setCopied(null);
    }
  };

  const inputStyle = {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderColor: theme.borderPanel,
    color: theme.itemText,
  };

  return (
    <ModalShell
      title={t.shareTitle}
      theme={theme}
      onClose={onClose}
      closeButtonLabel={t.btnClose}
      resizable={false}
      movable={false}
    >
      <div className="flex flex-col gap-[var(--space-3)] font-mono text-xs">
        <p className="m-0 opacity-80 leading-relaxed">{t.shareIntro}</p>

        <div className="flex flex-col gap-[var(--space-1)]">
          <label htmlFor="share-folder" className="font-bold">
            {t.shareFolderLabel}
          </label>
          <div className="flex gap-[var(--space-2)]">
            <input
              id="share-folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder={t.shareNoFolder}
              spellCheck={false}
              className="flex-1 min-w-0 rounded border px-[var(--space-2)] py-[var(--space-1)]"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => void choose()}
              className="shrink-0 flex items-center gap-[var(--space-1)] rounded border px-[var(--space-2)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 cursor-pointer"
              style={{ borderColor: theme.borderPanel }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t.shareChooseFolder}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-[var(--space-2)]">
          <label htmlFor="share-port" className="font-bold">
            {t.sharePortLabel}
          </label>
          <input
            id="share-port"
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            inputMode="numeric"
            className="w-24 rounded border px-[var(--space-2)] py-[var(--space-1)]"
            style={inputStyle}
          />
          <span className="opacity-60">{status.active ? t.shareActive : t.shareInactive}</span>
        </div>

        {status.active ? (
          <div className="flex flex-col gap-[var(--space-2)]">
            <div className="font-bold">{t.shareLinkLabel}</div>
            {status.urls.length ? (
              status.urls.map((url) => (
                <div key={url} className="flex items-center gap-[var(--space-2)]">
                  <code className="flex-1 min-w-0 truncate rounded bg-black/30 px-[var(--space-2)] py-[var(--space-1)]">
                    {url}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(url)}
                    className="shrink-0 rounded border px-[var(--space-2)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 cursor-pointer"
                    style={{ borderColor: theme.borderPanel }}
                  >
                    {copied === url ? t.shareCopied : t.shareCopyLink}
                  </button>
                </div>
              ))
            ) : (
              <div className="opacity-70">{t.shareNoAddress}</div>
            )}
            <p className="m-0 opacity-70 leading-relaxed">{t.shareWarning}</p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="m-0 nc-danger-ink">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-[var(--space-2)] pt-[var(--space-1)]">
          <button
            type="button"
            onClick={onClose}
            className="px-[var(--space-3)] py-[var(--space-1)] rounded bg-white/10 hover:bg-white/20 cursor-pointer"
          >
            {t.btnCancel}
          </button>
          {status.active ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void stop()}
              className="px-[var(--space-3)] py-[var(--space-1)] rounded nc-danger-fill hover:nc-danger-fill text-white font-bold cursor-pointer disabled:opacity-50"
            >
              {t.shareStop}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="flex items-center gap-[var(--space-1)] px-[var(--space-3)] py-[var(--space-1)] rounded bg-amber-400 hover:bg-amber-300 text-black font-bold cursor-pointer disabled:opacity-50"
            >
              <Share2 className="w-3.5 h-3.5" />
              {t.shareStart}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

export default ShareModal;
