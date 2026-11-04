import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HeaderMenuBar } from './HeaderMenuBar';
import { translations } from '../i18n/translations';
import { themes } from '../services/themeManager';

/**
 * The menu bar opens on click by default, and on hover when Settings asks for
 * it. The interesting part is not that a hover opens a menu, but that it does
 * nothing at all when the option is off, that crossing on to the next title
 * moves the menu instead of stacking two, and that leaving the bar closes what
 * hovering opened.
 */
const t = translations.es;

/** The PWA button asks the browser about its display mode; jsdom has no such API. */
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const renderBar = (hoverOpen: boolean) =>
  render(
    <HeaderMenuBar
      theme={themes.classic_blue}
      lang="es"
      hoverOpen={hoverOpen}
      onOpenModal={vi.fn()}
      onRefresh={vi.fn()}
      onSelectAll={vi.fn()}
      onInvertSelection={vi.fn()}
      onToggleQuickView={vi.fn()}
      onToggleTree={vi.fn()}
      onNewTab={vi.fn()}
      onChangeDrive={vi.fn()}
      activePanel="left"
      isQuickView={false}
      isTreeVisible={false}
      onSetTheme={vi.fn()}
      onSetLang={vi.fn()}
      onResetDefaults={vi.fn()}
    />,
  );

const title = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });

describe('menu bar hover', () => {
  it('keeps every menu closed on hover when the option is off', () => {
    renderBar(false);

    fireEvent.mouseOver(title(t.menuLeft));

    expect(screen.queryByText(t.newTab)).toBeNull();
  });

  it('opens the menu the pointer crosses, and moves to the next title', () => {
    vi.useFakeTimers();
    const { container } = renderBar(true);

    fireEvent.mouseOver(title(t.menuLeft));
    expect(screen.getAllByText(t.newTab)).toHaveLength(1);

    fireEvent.mouseOver(title(t.menuFiles));
    // One menu at a time: the Files menu is open and the previous one is gone.
    expect(screen.getByText(t.view)).toBeDefined();
    expect(screen.queryByText(t.newTab)).toBeNull();

    // Leaving the bar closes it, because nothing was clicked. The close waits a
    // moment so the pointer can cross the gap onto the panel.
    fireEvent.mouseOut(container.firstElementChild as Element, { relatedTarget: document.body });
    expect(screen.getByText(t.view)).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText(t.view)).toBeNull();
    vi.useRealTimers();
  });

  it('survives the gap between a title and its panel', () => {
    vi.useFakeTimers();
    const { container } = renderBar(true);
    const bar = container.firstElementChild as Element;

    fireEvent.mouseOver(title(t.menuLeft));
    expect(screen.getAllByText(t.newTab)).toHaveLength(1);

    // On the way down to the panel the pointer is over neither box — the two
    // pixels between them belong to no element — so the bar counted it as gone
    // and the menu closed before it could be reached. Coming back cancels the
    // close.
    fireEvent.mouseOut(bar, { relatedTarget: document.body });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    fireEvent.mouseOver(bar);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getAllByText(t.newTab)).toHaveLength(1);

    // Leaving for good still closes it.
    fireEvent.mouseOut(bar, { relatedTarget: document.body });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText(t.newTab)).toBeNull();
    vi.useRealTimers();
  });

  it('leaves a menu opened by a click alone when the pointer leaves the bar', () => {
    const { container } = renderBar(false);

    fireEvent.click(title(t.menuLeft));
    expect(screen.getAllByText(t.newTab)).toHaveLength(1);

    fireEvent.mouseOut(container.firstElementChild as Element, { relatedTarget: document.body });
    expect(screen.getAllByText(t.newTab)).toHaveLength(1);
  });
});
