import { useEffect, useRef, useState } from 'react';
import { UserSettings } from '../types';

/**
 * Manual dual-pane width resizing. Tracks the drag state and, while dragging,
 * maps the pointer X position over the #dual-panel-container to a 20-80% ratio.
 * Extracted from App to keep the component focused.
 *
 * The ratio is kept in local state while dragging and committed to settings
 * once, on release. Writing settings on every mousemove re-rendered the whole
 * app and persisted the full settings object to localStorage once per pixel.
 */
export function useSplitter(setSettings: React.Dispatch<React.SetStateAction<UserSettings>>, committedRatio: number) {
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  // Read the latest ratio inside the release handler without re-subscribing.
  const dragRatioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const updateSplitterRatio = (clientX: number) => {
      const container = document.getElementById('dual-panel-container');
      if (container) {
        const rect = container.getBoundingClientRect();
        const offsetX = clientX - rect.left;
        const newRatio = Math.max(20, Math.min(80, Math.round((offsetX / rect.width) * 100)));
        dragRatioRef.current = newRatio;
        setDragRatio(newRatio);
      }
    };

    const handleMouseMove = (e: MouseEvent) => updateSplitterRatio(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      // Only block native touch scrolling while the splitter is actually being
      // dragged; otherwise every swipe in the app (path bar, file list,
      // drive bar...) would be cancelled and could not scroll.
      if (!isDraggingSplitter || !e.touches.length) return;
      e.preventDefault();
      updateSplitterRatio(e.touches[0].clientX);
    };
    const handleMouseUp = () => {
      // Commit the final ratio a single time, after the pointer is released.
      const finalRatio = dragRatioRef.current;
      if (finalRatio !== null) {
        setSettings((s) => ({ ...s, dualPaneRatio: finalRatio }));
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
  }, [isDraggingSplitter, setSettings]);

  // While dragging, the panes follow the live pointer; otherwise the committed
  // settings value is authoritative (it also reflects external resets).
  const ratio = dragRatio ?? committedRatio;

  return { isDraggingSplitter, setIsDraggingSplitter, ratio };
}
