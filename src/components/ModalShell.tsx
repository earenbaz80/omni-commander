import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { useModalDialog } from '../hooks/useModalDialog';

interface ModalShellProps {
  title?: string;
  label?: string;
  theme: ThemeConfig;
  children: React.ReactNode;
  onClose?: () => void;
  overlay?: boolean;
  closeButtonLabel?: string;
  /**
   * Draws minimise and maximise/restore next to the close button, for dialogs
   * that behave like a window of their own (the map). The rest of the app's
   * dialogs are short-lived questions and keep the plain close button.
   */
  windowControls?: boolean;
  minimizeLabel?: string;
  maximizeLabel?: string;
  restoreLabel?: string;
  /**
   * Lets the panel be dragged out by its bottom-right corner. A dialog that
   * behaves like a window is expected to be resizable like one.
   */
  resizable?: boolean;
  resizeLabel?: string;
  /**
   * Name for the title bar as a keyboard handle: the arrow keys carry the panel
   * with it, which is the only way to move a window without a pointer.
   */
  moveLabel?: string;
  /**
   * Lets the title bar carry the panel around, which is the other half of
   * behaving like a window. Buttons in the bar keep working as buttons.
   */
  movable?: boolean;
  /**
   * The body takes the remaining height and hands it to its content instead of
   * scrolling it. Dialogs whose content has a height of its own (the map) need
   * this to grow with the panel.
   */
  fill?: boolean;
  /**
   * Told whether the panel has a definite height — it was maximised or dragged
   * to a size — so content can fill it rather than keep a fixed height.
   */
  onFillChange?: (fills: boolean) => void;
}

/** Below this the dialog is unusable, whatever the drag says. */
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 220;
/** The overlay's own inset, kept clear so the panel never touches an edge. */
const SCREEN_GUTTER = 32;
/** How far one arrow press moves or sizes the panel. */
const KEY_STEP = 16;
/** Shift on the corner is the fine step, for lining a window up exactly. */
const KEY_FINE_STEP = 4;
/** Each arrow's vector: the same one moves the panel and grows it, so one map serves both. */
const ARROW_STEPS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Consolidated modal shell component that provides consistent:
 * - Backdrop with z-index and overlay handling
 * - Header with title/label and close button
 * - Focus trap via useModalDialog hook
 * - Keyboard escape key handling
 * - Consistent stacking order
 */
function ModalShell({
  title,
  label,
  theme,
  children,
  onClose,
  overlay = true,
  closeButtonLabel = 'Cerrar modal',
  windowControls = false,
  minimizeLabel = 'Minimizar',
  maximizeLabel = 'Maximizar',
  restoreLabel = 'Restaurar',
  resizable = true,
  resizeLabel = 'Redimensionar ventana',
  moveLabel = 'Mover ventana',
  movable = true,
  fill = false,
  onFillChange,
}: ModalShellProps): React.JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null);
  // Rolled up to its title bar, like the window it imitates.
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  /**
   * The size the corner was dragged out to, plus the corner it was dragged
   * from. `null` means the dialog's own size, still centred by the overlay.
   */
  const [size, setSize] = useState<{ width: number; height: number; left: number; top: number } | null>(null);
  /**
   * The size the last key press produced, read out to a screen reader. Without
   * it the window changes under the keyboard in silence and the user cannot
   * tell how big it ended up.
   */
  const [announcement, setAnnouncement] = useState('');
  const dragging = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);
  const moving = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // Use the shared modal dialog hook for consistent behavior
  // Prefer explicit `label` for accessibility (aria-label), fallback to `title`
  const titleText = label || title || 'Modal';
  useModalDialog<HTMLDivElement>(titleText, modalRef);

  // A dialog with a height of its own either fills the viewport or was dragged
  // to a size; either way its content is expected to grow with it. The map used
  // to guess the chrome away with `calc(100vh - …)`, which left it the same
  // height on a maximised window as on a small one.
  const fills = maximized || size !== null;

  useEffect(() => {
    onFillChange?.(fills);
  }, [fills, onFillChange]);

  // A panel dragged out to a size is anchored, so it no longer follows the
  // overlay's centring. If the window itself shrinks afterwards the panel has to
  // be pulled back inside it instead of hanging off the edge.
  useEffect(() => {
    if (!size) return;
    const fit = () => {
      setSize((current) => {
        if (!current) return current;
        const width = Math.min(current.width, Math.max(MIN_PANEL_WIDTH, window.innerWidth - SCREEN_GUTTER));
        const height = Math.min(current.height, Math.max(MIN_PANEL_HEIGHT, window.innerHeight - SCREEN_GUTTER));
        const left = Math.max(0, Math.min(current.left, window.innerWidth - width));
        const top = Math.max(0, Math.min(current.top, window.innerHeight - height));
        return width === current.width && height === current.height && left === current.left && top === current.top
          ? current
          : { width, height, left, top };
      });
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [size]);

  const toggleMaximized = () => {
    setMaximized((current) => !current);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = modalRef.current;
    if (!panel || maximized) return;
    const rect = panel.getBoundingClientRect();
    dragging.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    // The pointer leaves the small corner as soon as the drag starts; without
    // the capture the panel would stop following it a few pixels later.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer to capture on this platform */
    }
    event.preventDefault();
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragging.current;
    if (!start || start.pointerId !== event.pointerId) return;
    // The corner under the pointer is the one being dragged, so the panel has to
    // keep the top-left it started with. A centred panel grew both ways and the
    // corner ran away from the cursor at half speed, which is why the drag never
    // felt like it was landing where the pointer was.
    const widest = Math.max(MIN_PANEL_WIDTH, window.innerWidth - SCREEN_GUTTER - start.left);
    const tallest = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - SCREEN_GUTTER - start.top);
    const width = Math.min(widest, Math.max(MIN_PANEL_WIDTH, start.width + event.clientX - start.x));
    const height = Math.min(tallest, Math.max(MIN_PANEL_HEIGHT, start.height + event.clientY - start.y));
    setSize({
      width,
      height,
      left: Math.max(0, Math.min(start.left, window.innerWidth - width)),
      top: Math.max(0, Math.min(start.top, window.innerHeight - height)),
    });
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragging.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const controlButton =
    'p-[var(--space-1)] rounded hover:bg-black/20 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  /**
   * The title bar is the window's handle. The corner alone only grows a dialog
   * towards the bottom right, which on a centred overlay can run out of screen
   * before the dialog is the size you wanted; being able to pick it up and put
   * it where there is room is what makes the size usable.
   */
  const startMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = modalRef.current;
    if (!panel || !movable || maximized) return;
    // A press that lands on a title-bar control belongs to that control.
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const rect = panel.getBoundingClientRect();
    moving.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: size?.left ?? rect.left,
      top: size?.top ?? rect.top,
      width: size?.width ?? rect.width,
      height: size?.height ?? rect.height,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer to capture on this platform */
    }
    event.preventDefault();
  };

  const moveMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = moving.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const left = Math.max(0, Math.min(window.innerWidth - start.width, start.left + event.clientX - start.x));
    const top = Math.max(0, Math.min(window.innerHeight - start.height, start.top + event.clientY - start.y));
    setSize({ width: start.width, height: start.height, left, top });
  };

  const endMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = moving.current;
    if (!start || start.pointerId !== event.pointerId) return;
    moving.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // `max-w-none` is what lets a dragged panel pass the dialog width it was
  // designed for; the inline size is clamped to the viewport above.
  /**
   * The panel's geometry right now: what a drag left behind, or the box the
   * overlay centred it in. The keyboard starts from the same place the pointer
   * does, so both gestures agree about where the window is.
   */
  const geometryNow = () => {
    const panel = modalRef.current;
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    return size ?? { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
  };

  /** The same caps the corner drag applies, so a key press cannot leave the screen either. */
  const clampSize = (width: number, height: number, left: number, top: number) => ({
    width: Math.min(
      Math.max(MIN_PANEL_WIDTH, window.innerWidth - SCREEN_GUTTER - left),
      Math.max(MIN_PANEL_WIDTH, width),
    ),
    height: Math.min(
      Math.max(MIN_PANEL_HEIGHT, window.innerHeight - SCREEN_GUTTER - top),
      Math.max(MIN_PANEL_HEIGHT, height),
    ),
  });

  const applyGeometry = (next: { width: number; height: number; left: number; top: number }) => {
    setSize(next);
    setAnnouncement(`${Math.round(next.width)} × ${Math.round(next.height)}`);
  };

  /** Arrow keys on the title bar carry the panel; with Shift they size it. */
  const handleMoveKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // A key press that belongs to a control in the bar is that control's.
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const direction: { x: number; y: number } | undefined = ARROW_STEPS[event.key];
    if (!direction) return;
    const geometry = geometryNow();
    if (!geometry) return;
    event.preventDefault();

    if (event.shiftKey) {
      const { width, height } = clampSize(
        geometry.width + direction.x * KEY_STEP,
        geometry.height + direction.y * KEY_STEP,
        geometry.left,
        geometry.top,
      );
      applyGeometry({
        width,
        height,
        left: Math.max(0, Math.min(geometry.left, window.innerWidth - width)),
        top: Math.max(0, Math.min(geometry.top, window.innerHeight - height)),
      });
      return;
    }

    applyGeometry({
      width: geometry.width,
      height: geometry.height,
      left: Math.max(0, Math.min(window.innerWidth - geometry.width, geometry.left + direction.x * KEY_STEP)),
      top: Math.max(0, Math.min(window.innerHeight - geometry.height, geometry.top + direction.y * KEY_STEP)),
    });
  };

  /** Arrow keys on the corner size the panel; Shift is the fine step. */
  const handleResizeKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction: { x: number; y: number } | undefined = ARROW_STEPS[event.key];
    if (!direction) return;
    const geometry = geometryNow();
    if (!geometry) return;
    event.preventDefault();
    const step = event.shiftKey ? KEY_FINE_STEP : KEY_STEP;
    const { width, height } = clampSize(
      geometry.width + direction.x * step,
      geometry.height + direction.y * step,
      geometry.left,
      geometry.top,
    );
    applyGeometry({
      width,
      height,
      left: Math.max(0, Math.min(geometry.left, window.innerWidth - width)),
      top: Math.max(0, Math.min(geometry.top, window.innerHeight - height)),
    });
  };

  const panelSizeClass = maximized ? 'h-full w-full max-w-none' : size ? 'max-w-none' : 'max-h-full w-full max-w-3xl';

  const bodyClass = fill
    ? `min-h-0 flex flex-col p-[var(--space-4)] ${fills ? 'flex-1 overflow-hidden' : 'overflow-y-auto'}`
    : `min-h-0 overflow-y-auto p-[var(--space-4)] ${maximized ? 'flex-1' : ''}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-[var(--space-4)]"
      style={{
        backgroundColor: overlay ? theme.overlay : 'transparent',
      }}
    >
      <div
        ref={modalRef}
        // A cap and a scroll area, not just `overflow-hidden`: a dialog taller
        // than the window used to be clipped at both ends with no way to reach
        // its footer (the folder-sync table grew past the screen edges).
        className={`relative flex flex-col overflow-hidden rounded border bg-app shadow-lg ${panelSizeClass}`}
        style={{
          borderColor: theme.modalBorder,
          backgroundColor: theme.modalBg,
          ...(size && !maximized
            ? { position: 'absolute' as const, left: size.left, top: size.top, width: size.width, height: size.height }
            : null),
        }}
      >
        {/* Header. It is also the keyboard's handle: the arrows carry the window,
            Shift+arrows size it. Without a focusable bar, moving a window was
            pointer-only, which left the whole layout out of reach of a keyboard. */}
        <div
          onPointerDown={startMove}
          onPointerMove={moveMove}
          onPointerUp={endMove}
          onPointerCancel={endMove}
          onLostPointerCapture={endMove}
          tabIndex={movable && !maximized ? 0 : undefined}
          role={movable && !maximized ? 'group' : undefined}
          aria-label={movable && !maximized ? moveLabel : undefined}
          onKeyDown={movable && !maximized ? handleMoveKeys : undefined}
          className={`flex shrink-0 select-none items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b ${
            movable && !maximized
              ? 'cursor-grab touch-none active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]'
              : ''
          }`}
          style={{
            backgroundColor: theme.modalHeaderBg,
            borderColor: theme.modalBorder,
          }}
        >
          <h3 className="text-sm font-bold text-left" style={{ color: theme.modalHeaderText }}>
            {title || label}
          </h3>
          <div className="flex items-center gap-[var(--space-1)]">
            {windowControls && (
              <>
                <button
                  onClick={() => setMinimized((current) => !current)}
                  aria-label={minimizeLabel}
                  title={minimizeLabel}
                  aria-pressed={minimized}
                  className={controlButton}
                  style={{ color: theme.modalHeaderText }}
                >
                  <Minus size={16} />
                </button>
                <button
                  onClick={toggleMaximized}
                  aria-label={maximized ? restoreLabel : maximizeLabel}
                  title={maximized ? restoreLabel : maximizeLabel}
                  aria-pressed={maximized}
                  className={controlButton}
                  style={{ color: theme.modalHeaderText }}
                >
                  {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </>
            )}
            {onClose && (
              <button
                onClick={onClose}
                aria-label={closeButtonLabel}
                className={controlButton}
                style={{ color: theme.modalHeaderText }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={bodyClass} hidden={minimized}>
          {children}
        </div>

        {/* A screen reader hears the size the keys just produced; otherwise the
            window changes in silence. */}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {/* A window is resizeable by its corner; a maximised one already fills the
            screen. The corner is a tab stop with the arrows doing the same job
            the pointer does, and it reports the width it changes. */}
        {resizable && !maximized && (
          <div
            role="separator"
            aria-label={resizeLabel}
            title={resizeLabel}
            tabIndex={0}
            aria-orientation="horizontal"
            aria-valuenow={size ? Math.round(size.width) : undefined}
            aria-valuemin={MIN_PANEL_WIDTH}
            aria-valuemax={Math.max(MIN_PANEL_WIDTH, Math.round(window.innerWidth - SCREEN_GUTTER))}
            onKeyDown={handleResizeKeys}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            className="absolute bottom-0 right-0 z-10 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end p-[2px] hover:bg-white/10 focus-visible:outline focus-visible:outline-2"
            style={{ color: theme.modalBorder }}
          >
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M9 2 L2 9 M9 6 L6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            </svg>
          </div>
        )}

        {/* Footer - optional, can be conditionally rendered in child components */}
      </div>
    </div>
  );
}

export default ModalShell;
