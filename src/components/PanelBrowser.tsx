import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react';
import { LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { OVERLAY_MENU_EVENT } from '../services/overlayEvents';

interface PanelBrowserProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  /** Address the panel opens on, if the caller has one in mind. */
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

/** How often the native view is placed over its box while the layout moves. */
const BOUNDS_SYNC_MS = 200;

/**
 * The built-in browser, hosted by one of the panes instead of its own window.
 *
 * The page is a `WebContentsView` owned by the main process, so this component
 * renders a box and keeps the real page on top of it: the box reports where it
 * is and the main process moves the view there. The main process owns a single
 * view, which is why opening the browser window closes the one in a panel (see
 * App): two hosts would push the same view in two directions.
 */
export const PanelBrowser: React.FC<PanelBrowserProps> = ({ theme, lang, startUrl, onClose }) => {
  const t = getTranslations(lang);
  const [address, setAddress] = useState(startUrl ?? '');
  const [page, setPage] = useState<BrowserPageState>(EMPTY_PAGE);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const menuOpenRef = useRef(false);
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
  // creates it, unmounting closes it, so closing the panel leaves no page running.
  useEffect(() => {
    if (!available) return;
    void bridge?.openBrowser?.(startUrl ?? '');
    const unsubscribe = bridge?.onBrowserState?.((next) => {
      setPage(next);
      if (next.url) setAddress(next.url);
    });
    return () => {
      unsubscribe?.();
      void bridge?.closeBrowser?.();
    };
  }, [available, bridge, startUrl]);

  // The page is a native layer above the panel, so something has to tell it where
  // the box went: a poll covers the split drag, the window resize and a swap.
  useEffect(() => {
    if (!available) return;
    const sync = () => {
      const box = boxRef.current;
      if (!box || !bridge?.setBrowserBounds) return;
      // An empty box is how the main process hides the view, and it keeps the
      // page at its own size instead of reflowing it to nothing.
      if (menuOpenRef.current) {
        void bridge.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 });
        return;
      }
      const rect = box.getBoundingClientRect();
      void bridge.setBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    const onMenu = (event: Event) => {
      menuOpenRef.current = Boolean((event as CustomEvent<boolean>).detail);
      sync();
    };
    sync();
    const timer = window.setInterval(sync, BOUNDS_SYNC_MS);
    window.addEventListener('resize', sync);
    window.addEventListener(OVERLAY_MENU_EVENT, onMenu);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', sync);
      window.removeEventListener(OVERLAY_MENU_EVENT, onMenu);
    };
  }, [available, bridge]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-[var(--space-1)] p-[var(--space-1)] font-mono text-xs"
      data-panel-browser
    >
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
              style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderColor: theme.borderPanel, color: theme.itemText }}
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
        <button
          type="button"
          onClick={onClose}
          title={t.btnClose}
          aria-label={t.btnClose}
          className="rounded border px-[var(--space-2)] py-[var(--space-1)] hover:nc-danger-surface-strong"
          style={{ borderColor: theme.borderPanel }}
        >
          <X className="h-3.5 w-3.5 nc-danger-ink" />
        </button>
      </div>

      {error ? (
        <p role="alert" className="m-0 shrink-0 nc-danger-ink">
          {error}
        </p>
      ) : null}

      {available ? (
        <div
          ref={boxRef}
          aria-label={t.browserTitle}
          className="min-h-[200px] flex-1 rounded border"
          style={{ borderColor: theme.borderPanel, backgroundColor: 'rgba(0,0,0,0.25)' }}
        />
      ) : (
        <p className="m-0 opacity-70">{t.browserUnavailable}</p>
      )}
    </div>
  );
};

export default PanelBrowser;
