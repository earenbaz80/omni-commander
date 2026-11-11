import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import ModalShell from '../ModalShell';

interface BrowserModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  /** Address the window opens on, if the caller has one in mind. */
  startUrl?: string;
  onClose: () => void;
}

interface BrowserPageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

const EMPTY_PAGE: BrowserPageState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false };

/** How often the native view is placed over its box while the window moves. */
const BOUNDS_SYNC_MS = 200;

/**
 * The app's own web browser, as a window of its own.
 *
 * The page is not an iframe: it is a `WebContentsView` owned by the main process,
 * which is the only way to show sites that refuse to be framed. That is also why
 * this component renders a box and keeps the real page on top of it: the box
 * reports where it is, and the main process moves the view there. Everything
 * else — the isolated session, the denied permissions, the dropped downloads —
 * lives on the other side of the bridge.
 */
export const BrowserModal: React.FC<BrowserModalProps> = ({ theme, lang, startUrl, onClose }) => {
  const t = getTranslations(lang);
  const [address, setAddress] = useState(startUrl ?? '');
  const [page, setPage] = useState<BrowserPageState>(EMPTY_PAGE);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const available = !!bridge?.openBrowser;

  const navigate = useCallback(
    async (value: string) => {
      const answer = await bridge?.navigateBrowser?.(value);
      if (answer && !answer.ok) setError(t.browserOpenFailed);
      else setError('');
    },
    [bridge, t.browserOpenFailed],
  );

  // The view outlives this component only as long as it is on screen: mounting
  // creates it, unmounting closes it, so a closed window leaves no page running.
  useEffect(() => {
    if (!available) return;
    void bridge?.openBrowser?.(startUrl ?? '');
    const unsubscribe = bridge?.onBrowserState?.((next) => {
      setPage(next);
      // The address follows the page: a redirect or a clicked link has to show
      // where it went, not what was typed before.
      if (next.url) setAddress(next.url);
    });
    return () => {
      unsubscribe?.();
      void bridge?.closeBrowser?.();
    };
  }, [available, bridge, startUrl]);

  // The page is a native layer above the window, so something has to tell it
  // where the box went. A poll covers the cases a resize event does not: the
  // title bar drag, the corner drag and the modal being maximised.
  useEffect(() => {
    if (!available) return;
    const sync = () => {
      const box = boxRef.current;
      if (!box || !bridge?.setBrowserBounds) return;
      const rect = box.getBoundingClientRect();
      void bridge.setBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    sync();
    const timer = window.setInterval(sync, BOUNDS_SYNC_MS);
    window.addEventListener('resize', sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', sync);
    };
  }, [available, bridge]);

  return (
    <ModalShell
      title={page.title || t.browserTitle}
      theme={theme}
      onClose={onClose}
      closeButtonLabel={t.btnClose}
      windowControls
      minimizeLabel={t.minimize}
      maximizeLabel={t.maximizeRestore}
      restoreLabel={t.maximizeRestore}
      resizeLabel={t.resizeWindow}
      moveLabel={t.moveWindow}
      resizable
      movable
      fill
    >
      <div className="flex min-h-0 flex-col gap-[var(--space-2)] font-mono text-xs">
        <div className="flex shrink-0 items-center gap-[var(--space-1)]">
          <button
            type="button"
            disabled={!page.canGoBack}
            onClick={() => void bridge?.browserCommand?.('back')}
            title={t.browserBack}
            aria-label={t.browserBack}
            className="rounded border px-[var(--space-2)] py-[var(--space-1)] hover:bg-white/20 disabled:opacity-40"
            style={{ borderColor: theme.borderPanel }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!page.canGoForward}
            onClick={() => void bridge?.browserCommand?.('forward')}
            title={t.browserForward}
            aria-label={t.browserForward}
            className="rounded border px-[var(--space-2)] py-[var(--space-1)] hover:bg-white/20 disabled:opacity-40"
            style={{ borderColor: theme.borderPanel }}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void bridge?.browserCommand?.('reload')}
            title={t.browserReload}
            aria-label={t.browserReload}
            className="rounded border px-[var(--space-2)] py-[var(--space-1)] hover:bg-white/20"
            style={{ borderColor: theme.borderPanel }}
          >
            <RotateCw className={`h-3.5 w-3.5 ${page.loading ? 'animate-spin' : ''}`} />
          </button>

          <form
            className="flex min-w-0 flex-1 items-center gap-[var(--space-1)]"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate(address);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Globe className="pointer-events-none absolute left-[var(--space-2)] top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={t.browserAddress}
                spellCheck={false}
                aria-label={t.browserAddress}
                className="w-full rounded border py-[var(--space-1)] pl-[calc(var(--space-2)*2+14px)] pr-[var(--space-2)]"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  borderColor: theme.borderPanel,
                  color: theme.itemText,
                }}
              />
            </div>
          </form>

          <button
            type="button"
            disabled={!page.url}
            onClick={() => void bridge?.openExternal?.(page.url)}
            title={t.browserOpenExternal}
            aria-label={t.browserOpenExternal}
            className="rounded border px-[var(--space-2)] py-[var(--space-1)] hover:bg-white/20 disabled:opacity-40"
            style={{ borderColor: theme.borderPanel }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        {error ? (
          <p role="alert" className="m-0 shrink-0 text-red-300">
            {error}
          </p>
        ) : null}

        {available ? (
          // The native page floats exactly over this box; what it paints here is
          // the empty frame the view is parked on.
          <div
            ref={boxRef}
            aria-label={t.browserTitle}
            // It keeps a size of its own until the window is dragged or
            // maximised; then `flex-1` takes over and it grows with the dialog.
            className="min-h-[320px] flex-1 rounded border"
            style={{ borderColor: theme.borderPanel, backgroundColor: 'rgba(0,0,0,0.25)' }}
          />
        ) : (
          <p className="m-0 opacity-70">{t.browserUnavailable}</p>
        )}

        <p className="m-0 shrink-0 text-[10px] opacity-55">{t.browserPrivacy}</p>
      </div>
    </ModalShell>
  );
};

export default BrowserModal;
