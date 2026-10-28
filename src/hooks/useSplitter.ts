import { useEffect, useRef, useState } from 'react';
import { UserSettings } from '../types';

/**
 * Manual dual-pane resizing. Tracks the drag state and, while dragging, maps the
 * pointer position over the #dual-panel-container to a 20-80% ratio. Extracted
 * from App to keep the component focused.
 *
 * The ratio is the first pane's share along the axis the panels are split on:
 * its width when they sit side by side, its height when they are stacked. Each
 * arrangement remembers its own split: a 70% tall pane says nothing about how
 * wide a column should be, and sharing one number turned every layout switch
 * into an unexplained jump.
 *
 * The ratio is kept in local state while dragging and committed to settings
 * once, on release. Writing settings on every mousemove re-rendered the whole
 * app and persisted the full settings object to localStorage once per pixel.
 */
export function useSplitter(
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>,
  committedRatio: number,
  stacked = false,
) {
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  // Read the latest ratio inside the release handler without re-subscribing.
  const dragRatioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const updateSplitterRatio = (clientX: number, clientY: number) => {
      const container = document.getElementById('dual-panel-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Reading the wrong axis would drag toward a coordinate the panels do not
      // use, so the divider would jump to the edge instead of following.
      const offset = stacked ? clientY - rect.top : clientX - rect.left;
      const size = stacked ? rect.height : rect.width;
      if (size <= 0) return;
      const newRatio = Math.max(20, Math.min(80, Math.round((offset / size) * 100)));
      dragRatioRef.current = newRatio;
      setDragRatio(newRatio);
    };

    const handleMouseMove = (e: MouseEvent) => updateSplitterRatio(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      // Only block native touch scrolling while the splitter is actually being
      // dragged; otherwise every swipe in the app (path bar, file list,
      // drive bar...) would be cancelled and could not scroll.
      if (!isDraggingSplitter || !e.touches.length) return;
      e.preventDefault();
      updateSplitterRatio(e.touches[0].clientX, e.touches[0].clientY);
    };
    const handleMouseUp = () => {
      // Commit the final ratio a single time, after the pointer is released.
      const finalRatio = dragRatioRef.current;
      if (finalRatio !== null) {
        setSettings((s) => (stacked ? { ...s, dualPaneRatioRows: finalRatio } : { ...s, dualPaneRatio: finalRatio }));
      }
      setDragRatio(null);
      setIsDraggingSplitter(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleMouseUp);
    window.addEventListener('touchcancel', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
      window.removeEventListener('touchcancel', handleMouseUp);
    };
  }, [isDraggingSplitter, setSettings, stacked]);

  // While dragging, the panes follow the live pointer; otherwise the committed
  // settings value is authoritative (it also reflects external resets).
  const ratio = dragRatio ?? committedRatio;

  return { isDraggingSplitter, setIsDraggingSplitter, ratio };
}
