import { useEffect, useState } from 'react';
import { UserSettings } from '../types';

/**
 * Manual dual-pane width resizing. Tracks the drag state and, while dragging,
 * maps the pointer X position over the #dual-panel-container to a 20-80% ratio.
 * Extracted from App to keep the component focused.
 */
export function useSplitter(setSettings: React.Dispatch<React.SetStateAction<UserSettings>>) {
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const updateSplitterRatio = (clientX: number) => {
      const container = document.getElementById('dual-panel-container');
      if (container) {
        const rect = container.getBoundingClientRect();
        const offsetX = clientX - rect.left;
        const newRatio = Math.max(20, Math.min(80, Math.round((offsetX / rect.width) * 100)));
        setSettings((s) => ({ ...s, dualPaneRatio: newRatio }));
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

  return { isDraggingSplitter, setIsDraggingSplitter };
}
