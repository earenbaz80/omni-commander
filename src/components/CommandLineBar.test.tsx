import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandLineBar } from './CommandLineBar';
import { themes } from '../services/themeManager';
import { translations } from '../i18n/translations';
import type { CommandHistoryItem } from '../types';

vi.mock('../services/soundEffects', () => ({
  soundManager: {
    playKeyTick: vi.fn(),
    playSelectSound: vi.fn(),
    playDiskAccess: vi.fn(),
    playSuccess: vi.fn(),
  },
}));

// jsdom has no scrolling, and the popover scrolls the highlighted row into view.
Element.prototype.scrollIntoView = () => {};

const t = translations.es;
const onExecuteCommand = vi.fn();
const onClearHistory = vi.fn();
const onToggleAdminMode = vi.fn();

const history: CommandHistoryItem[] = [
  { id: '1', command: 'dir', output: 'volumen C', timestamp: '10:00', status: 'ok' },
  { id: '2', command: 'cls', output: '', timestamp: '10:01', status: 'ok' },
] as CommandHistoryItem[];

const renderBar = (overrides: Record<string, unknown> = {}) =>
  render(
    <CommandLineBar
      theme={themes.classic_blue}
      lang="es"
      // A JSX string attribute does not process escapes: this has to be a plain
      // string expression or the prompt would show two backslashes.
      currentPath={'C:\\datos'}
      onExecuteCommand={onExecuteCommand}
      commandHistory={history}
      onClearHistory={onClearHistory}
      onToggleAdminMode={onToggleAdminMode}
      availableFileNames={['datos1', 'datos2']}
      {...overrides}
    />,
  );

const input = () => document.querySelector('input[type="text"]') as HTMLInputElement;
/** The suggestion rows are the only children of the popover list. */
const suggestionRows = () => Array.from(document.querySelectorAll('.max-h-48 > div')) as HTMLElement[];
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const submit = () => fireEvent.submit(document.querySelector('form')!);

beforeEach(() => {
  onExecuteCommand.mockReset();
  onClearHistory.mockReset();
  onToggleAdminMode.mockReset();
});

describe('CommandLineBar suggestions', () => {
  it('offers history, built-in commands and files, each labelled', () => {
    renderBar();
    type('d');

    const rows = suggestionRows();
    expect(rows.length).toBeGreaterThan(0);
    const text = rows.map((row) => row.textContent).join(' | ');
    expect(text).toContain('dir');
    expect(text).toContain(t.historyShort);
    expect(text).toContain('DOS');
    expect(text).toContain(t.file);
    // The popover never grows past a readable list.
    expect(rows.length).toBeLessThanOrEqual(7);
  });

  it('fills the input on a click without running anything', () => {
    renderBar();
    type('di');

    fireEvent.click(suggestionRows()[0]);

    expect(input().value).toBe('dir');
    expect(onExecuteCommand).not.toHaveBeenCalled();
    // Focusing the line again is what reopens the list; the pick itself did run
    // nothing, which is the point of a single click.
  });

  it('runs the entry on a double click', () => {
    renderBar();
    type('di');

    fireEvent.doubleClick(suggestionRows()[0]);

    expect(onExecuteCommand).toHaveBeenCalledWith('dir');
    expect(input().value).toBe('');
  });

  it('completes the rest of the word with the right arrow, but only from the end', () => {
    renderBar();
    type('di');

    input().setSelectionRange(1, 1);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(input().value).toBe('di');

    input().setSelectionRange(2, 2);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(input().value).toBe('dir');
  });

  it('closes the popover with escape and reopens it while typing', () => {
    renderBar();
    type('di');
    expect(suggestionRows().length).toBeGreaterThan(0);

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(suggestionRows().length).toBe(0);

    type('dir');
    expect(suggestionRows().length).toBeGreaterThan(0);
  });
});

describe('CommandLineBar running', () => {
  it('runs what was typed, clears the line and opens the log', () => {
    renderBar();
    type('  tree  ');

    submit();

    expect(onExecuteCommand).toHaveBeenCalledWith('tree');
    expect(input().value).toBe('');
    expect(document.querySelector('[data-command-log]')).toBeTruthy();
  });

  it('sends nothing when the line is empty', () => {
    renderBar();

    submit();

    expect(onExecuteCommand).not.toHaveBeenCalled();
  });

  it('runs the highlighted suggestion instead of the half-typed text', () => {
    renderBar();
    type('di');

    fireEvent.mouseEnter(suggestionRows()[0]);
    submit();

    expect(onExecuteCommand).toHaveBeenCalledWith('dir');
  });

  it('walks the history with the arrows once the popover is closed', () => {
    renderBar();

    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('cls');

    // Once the line holds a command, the arrows navigate its suggestions, so the
    // history needs the popover shut — escape is the key that shuts it.
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('dir');

    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().value).toBe('cls');

    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().value).toBe('');
  });

  it('completes a file name with tab and cycles through the matches', () => {
    renderBar();
    // After a space the candidates are the folder's entries only; at the start of
    // the line the built-in commands come first, and `date` would win.
    type('cd dat');

    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('cd datos1');

    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('cd datos2');

    fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true });
    expect(input().value).toBe('cd datos1');
  });
});

describe('CommandLineBar log', () => {
  it('stays folded until the toggle is used and then shows the runs', () => {
    renderBar();
    expect(document.querySelector('[data-command-log]')).toBeNull();

    fireEvent.click(screen.getByTitle(t.toggleConsole));

    const log = document.querySelector('[data-command-log]')!;
    expect(log.textContent).toContain(t.cmdShellTitle);
    expect(log.textContent).toContain('C:\\datos>');
    expect(log.textContent).toContain('volumen C');
  });

  it('opens on request from the host, without a click', () => {
    renderBar({ logOpenNonce: 1 });

    expect(document.querySelector('[data-command-log]')).toBeTruthy();
  });

  it('clears the history, folds the drawer and switches the shell mode', () => {
    renderBar();
    fireEvent.click(screen.getByTitle(t.toggleConsole));

    fireEvent.click(screen.getByText(new RegExp(t.clearLabel)));
    expect(onClearHistory).toHaveBeenCalled();

    fireEvent.click(screen.getByText(t.cmdUserShell));
    expect(onToggleAdminMode).toHaveBeenCalled();

    fireEvent.click(screen.getByText(new RegExp(t.hideLabel)));
    expect(document.querySelector('[data-command-log]')).toBeNull();
  });

  it('marks the prompt and the badge when the shell is elevated', () => {
    renderBar({ isAdminMode: true, logOpenNonce: 1 });

    expect(document.querySelector('[data-command-log]')!.textContent).toContain(t.cmdAdminElevated);
    expect(screen.getByText(`[ADMIN] C:\\datos>`)).toBeTruthy();
    expect(screen.getByText(t.cmdElevatedShell)).toBeTruthy();
  });

  it('says how to start when nothing has run yet', () => {
    renderBar({ commandHistory: [], logOpenNonce: 1 });

    expect(screen.getByText(t.cmdHelpHint)).toBeTruthy();
  });
});
