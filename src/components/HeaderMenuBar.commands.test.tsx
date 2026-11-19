import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeaderMenuBar } from './HeaderMenuBar';
import { translations } from '../i18n/translations';
import { themes } from '../services/themeManager';
import { setPlatformInfo, type PlatformInfo } from '../services/platform';

/**
 * The Commands menu lists the recycle bin as a command. A host whose adapter
 * declares no trash has nowhere to park a deleted file, so that entry is not
 * one this menu can offer.
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

const withTrash: PlatformInfo = {
  platform: 'win32',
  caseSensitive: false,
  separator: '\\',
  capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
};

const withoutTrash: PlatformInfo = {
  platform: 'linux',
  caseSensitive: true,
  separator: '/',
  capabilities: { paths: true, volumes: true, cleanup: false, trash: false, openWith: false },
};

afterEach(() => setPlatformInfo(withTrash));

const openCommands = () => {
  render(
    <HeaderMenuBar
      theme={themes.classic_blue}
      lang="es"
      hoverOpen={false}
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
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.menuCommands}$`, 'i') }));
};

describe('Commands menu recycle bin entry', () => {
  it('is listed where the adapter implements a trash', () => {
    setPlatformInfo(withTrash);

    openCommands();

    expect(screen.getByText(t.recycleBin)).toBeDefined();
  });

  it('is not listed where the adapter declares none', () => {
    setPlatformInfo(withoutTrash);

    openCommands();

    expect(screen.queryByText(t.recycleBin)).toBeNull();
    // The menu is still open, so the assertion above is about the entry.
    expect(screen.getByText(t.bookmarks)).toBeDefined();
  });
});
