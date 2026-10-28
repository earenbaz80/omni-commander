import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSplitter } from './useSplitter';
import type { UserSettings } from '../types';

/**
 * The divider has to follow the axis the panels are arranged on: X when they
 * sit side by side, Y when they are stacked. Reading the wrong one leaves the
 * ratio pinned at whatever the pointer was over, which looks like a divider
 * that ignores the drag.
 *
 * Each arrangement also keeps its own split. A 70% tall pane says nothing about
 * how wide a column should be, so the two numbers must not overwrite each other.
 */
beforeAll(() => {
  const container = document.createElement('div');
  container.id = 'dual-panel-container';
  // jsdom performs no layout, so the box the splitter measures against is
  // stated here instead of read from the browser.
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0 }) as DOMRect;
  document.body.appendChild(container);
});

const ratioAfterDrag = (stacked: boolean, pointer: { clientX: number; clientY: number }) => {
  const setSettings = vi.fn();
  const { result } = renderHook(() => useSplitter(setSettings, 50, stacked));

  act(() => result.current.setIsDraggingSplitter(true));
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', pointer));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  const updater = setSettings.mock.calls.at(-1)?.[0] as (s: UserSettings) => UserSettings;
  return updater({ dualPaneRatio: 50, dualPaneRatioRows: 50 } as UserSettings);
};

describe('useSplitter', () => {
  it('follows the horizontal pointer when the panels sit side by side', () => {
    const next = ratioAfterDrag(false, { clientX: 560, clientY: 380 });
    // 560 of 800 is 70%; the vertical position is irrelevant in this layout.
    expect(next.dualPaneRatio).toBe(70);
    expect(next.dualPaneRatioRows).toBe(50);
  });

  it('follows the vertical pointer when the panels are stacked', () => {
    const next = ratioAfterDrag(true, { clientX: 790, clientY: 120 });
    // 120 of 400 is 30%; the horizontal position is irrelevant here.
    expect(next.dualPaneRatioRows).toBe(30);
    expect(next.dualPaneRatio).toBe(50);
  });

  it('clamps both layouts to the same working range', () => {
    expect(ratioAfterDrag(false, { clientX: 5, clientY: 5 }).dualPaneRatio).toBe(20);
    expect(ratioAfterDrag(false, { clientX: 799, clientY: 5 }).dualPaneRatio).toBe(80);
    expect(ratioAfterDrag(true, { clientX: 5, clientY: 399 }).dualPaneRatioRows).toBe(80);
  });
});
